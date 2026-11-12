//! The real [`LlmClient`] — HTTP to the Ollama server on this machine.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;

use super::prompts::{response_schema, system_prompt, user_prompt, PromptInput};
use super::{AccountAnalysis, LlmError};

/// Literal IPv4 loopback, not `localhost`: macOS resolves `localhost` to `::1`
/// first, Ollama listens on IPv4 only, and the fallback costs about a second
/// per new connection.
const BASE_URL: &str = "http://127.0.0.1:11434";

/// The model the app asks for unless the user picks another.
pub const DEFAULT_MODEL: &str = "gemma4:e4b";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const STATUS_TIMEOUT: Duration = Duration::from_secs(3);
const CHAT_TIMEOUT: Duration = Duration::from_secs(30);
/// A pull has no overall deadline (it is a multi-gigabyte download), but a
/// stream that goes quiet for this long is treated as dead.
const PULL_STALL_TIMEOUT: Duration = Duration::from_secs(60);

/// Enough for the JSON object in `response_schema()` with a 140-char reason.
const MAX_REPLY_TOKENS: u32 = 96;
/// How long Ollama keeps the model in memory after a request. Triage is a
/// burst of requests with reading pauses in between.
const KEEP_ALIVE: &str = "10m";

/// Upper bound on one buffered NDJSON line from `/api/pull`.
const MAX_PULL_LINE_BYTES: usize = 1024 * 1024;

/// Whether categorisation can run right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OllamaState {
    /// Server is up and the wanted model is installed.
    Ready,
    /// Server is up but the wanted model has not been pulled.
    ModelMissing,
    /// Nothing usable is answering on the Ollama port.
    Unreachable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub state: OllamaState,
    /// The model the app wants, as configured.
    pub model: String,
    /// Every installed model, as Ollama names them. Backs the model picker.
    pub installed_models: Vec<String>,
}

/// Download progress summed over every layer of the model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullProgress {
    pub completed: u64,
    pub total: u64,
}

/// A local model server.
///
/// # Security (invariant 3)
///
/// `classify` takes a [`PromptInput`] and nothing else, so an implementation
/// is never handed a password to send. Do not widen that parameter.
#[async_trait::async_trait]
pub trait LlmClient: Send + Sync {
    /// Never fails: every failure to get an answer is `Unreachable`.
    async fn status(&self) -> OllamaStatus;

    async fn classify(&self, input: &PromptInput) -> Result<AccountAnalysis, LlmError>;

    /// Download the configured model, reporting progress as it changes.
    async fn pull(
        &self,
        on_progress: &(dyn Fn(PullProgress) + Send + Sync),
    ) -> Result<(), LlmError>;
}

pub struct OllamaClient {
    http: reqwest::Client,
    base_url: String,
    model: String,
    chat_timeout: Duration,
}

impl OllamaClient {
    pub fn new(model: impl Into<String>) -> Result<Self, LlmError> {
        Self::with_base_url(BASE_URL, model)
    }

    fn with_base_url(base_url: &str, model: impl Into<String>) -> Result<Self, LlmError> {
        let http = reqwest::Client::builder()
            // A system proxy must never see, or be able to answer for, a
            // loopback request.
            .no_proxy()
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .map_err(|_| LlmError::Unreachable)?;
        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            model: model.into(),
            chat_timeout: CHAT_TIMEOUT,
        })
    }

    fn unreachable_status(&self) -> OllamaStatus {
        OllamaStatus {
            state: OllamaState::Unreachable,
            model: self.model.clone(),
            installed_models: Vec::new(),
        }
    }
}

#[async_trait::async_trait]
impl LlmClient for OllamaClient {
    async fn status(&self) -> OllamaStatus {
        let resp = match self
            .http
            .get(format!("{}/api/tags", self.base_url))
            .timeout(STATUS_TIMEOUT)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => resp,
            Ok(resp) => {
                tracing::warn!(status = resp.status().as_u16(), "ollama /api/tags failed");
                return self.unreachable_status();
            }
            Err(_) => return self.unreachable_status(),
        };

        match resp.json::<TagsResponse>().await {
            Ok(tags) => status_from_tags(tags, &self.model),
            Err(_) => {
                tracing::warn!("ollama /api/tags returned an unreadable body");
                self.unreachable_status()
            }
        }
    }

    async fn classify(&self, input: &PromptInput) -> Result<AccountAnalysis, LlmError> {
        let resp = self
            .http
            .post(format!("{}/api/chat", self.base_url))
            .timeout(self.chat_timeout)
            .json(&chat_request(&self.model, input))
            .send()
            .await
            .map_err(transport_error)?;

        let status = resp.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(LlmError::ModelMissing {
                model: self.model.clone(),
            });
        }
        if !status.is_success() {
            return Err(LlmError::Http {
                status: status.as_u16(),
            });
        }

        let chat: ChatResponse = resp.json().await.map_err(|e| {
            if e.is_timeout() {
                LlmError::Timeout
            } else {
                LlmError::BadResponse
            }
        })?;
        // `message.content` is itself a JSON document in a string, so this is
        // the second of two parses.
        AccountAnalysis::from_model_json(&chat.message.content)
    }

    async fn pull(
        &self,
        on_progress: &(dyn Fn(PullProgress) + Send + Sync),
    ) -> Result<(), LlmError> {
        let mut resp = self
            .http
            .post(format!("{}/api/pull", self.base_url))
            .json(&json!({ "model": self.model, "stream": true }))
            .send()
            .await
            .map_err(transport_error)?;

        let status = resp.status();
        if !status.is_success() {
            return Err(LlmError::Http {
                status: status.as_u16(),
            });
        }

        let mut pull = PullStream::default();
        loop {
            let chunk = match tokio::time::timeout(PULL_STALL_TIMEOUT, resp.chunk()).await {
                Err(_) => return Err(LlmError::Timeout),
                Ok(Err(e)) => return Err(transport_error(e)),
                Ok(Ok(None)) => break,
                Ok(Ok(Some(chunk))) => chunk,
            };
            pull.feed(&chunk)?.into_iter().for_each(on_progress);
        }
        pull.finish()?.into_iter().for_each(on_progress);

        if pull.succeeded {
            Ok(())
        } else {
            // The stream ended without the final "success" line.
            Err(LlmError::BadResponse)
        }
    }
}

fn transport_error(e: reqwest::Error) -> LlmError {
    if e.is_timeout() {
        LlmError::Timeout
    } else {
        LlmError::Unreachable
    }
}

/// The `/api/chat` body for one account.
///
/// Everything per-account comes from `input`; the rest is constant, so the
/// system prompt prefix is reusable across requests.
fn chat_request(model: &str, input: &PromptInput) -> serde_json::Value {
    json!({
        "model": model,
        "stream": false,
        "format": response_schema(),
        "options": { "temperature": 0, "num_predict": MAX_REPLY_TOKENS },
        "keep_alive": KEEP_ALIVE,
        "messages": [
            { "role": "system", "content": system_prompt() },
            { "role": "user", "content": user_prompt(input) },
        ],
    })
}

#[derive(Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<TagsModel>,
}

#[derive(Deserialize)]
struct TagsModel {
    name: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    message: ChatMessage,
}

#[derive(Deserialize)]
struct ChatMessage {
    content: String,
}

fn status_from_tags(tags: TagsResponse, wanted: &str) -> OllamaStatus {
    let installed_models: Vec<String> = tags.models.into_iter().map(|m| m.name).collect();
    let wanted_key = normalize_model_name(wanted);
    let state = if installed_models
        .iter()
        .any(|name| normalize_model_name(name) == wanted_key)
    {
        OllamaState::Ready
    } else {
        OllamaState::ModelMissing
    };
    OllamaStatus {
        state,
        model: wanted.to_string(),
        installed_models,
    }
}

/// Canonical form for comparing model names: lowercase, with the implicit
/// `:latest` tag made explicit. `Gemma4` and `gemma4:latest` are one model.
fn normalize_model_name(name: &str) -> String {
    let name = name.trim().to_lowercase();
    // A colon before the last `/` is a registry port, not a tag.
    let last_segment = name.rsplit('/').next().unwrap_or(&name);
    if last_segment.contains(':') {
        name
    } else {
        format!("{name}:latest")
    }
}

/// One line of the `/api/pull` NDJSON stream.
#[derive(Deserialize)]
struct PullLine {
    status: Option<String>,
    digest: Option<String>,
    total: Option<u64>,
    completed: Option<u64>,
    error: Option<String>,
}

/// Reassembles NDJSON lines from arbitrary chunk boundaries and keeps a
/// running per-layer tally.
#[derive(Default)]
struct PullStream {
    buf: Vec<u8>,
    /// digest → (completed, total). Layers download in parallel and each line
    /// reports only its own layer, so overall progress is the sum.
    layers: HashMap<String, (u64, u64)>,
    /// The last progress handed out, so a repeat is not reported twice.
    reported: Option<PullProgress>,
    succeeded: bool,
}

impl PullStream {
    /// Take the next bytes off the wire. Returns the overall progress after
    /// each complete line that changed it, in order.
    fn feed(&mut self, chunk: &[u8]) -> Result<Vec<PullProgress>, LlmError> {
        let mut changes = Vec::new();
        self.buf.extend_from_slice(chunk);
        while let Some(newline) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=newline).collect();
            self.read_line(&line)?;
            changes.extend(self.take_change());
        }
        if self.buf.len() > MAX_PULL_LINE_BYTES {
            return Err(LlmError::BadResponse);
        }
        Ok(changes)
    }

    /// Consume a final line that had no trailing newline.
    fn finish(&mut self) -> Result<Vec<PullProgress>, LlmError> {
        let rest = std::mem::take(&mut self.buf);
        self.read_line(&rest)?;
        Ok(self.take_change().into_iter().collect())
    }

    /// The current progress, if it differs from what was last handed out.
    fn take_change(&mut self) -> Option<PullProgress> {
        let now = self.progress();
        if now.total == 0 || self.reported == Some(now) {
            return None;
        }
        self.reported = Some(now);
        Some(now)
    }

    fn read_line(&mut self, line: &[u8]) -> Result<(), LlmError> {
        // A line that is not JSON is skipped: one bad progress line is not a
        // reason to give up on a download that is otherwise working.
        let Ok(line) = serde_json::from_slice::<PullLine>(line) else {
            return Ok(());
        };

        if let Some(error) = line.error {
            // Ollama's own message, e.g. "pull model manifest: file does not
            // exist". Holds a model name at most.
            tracing::warn!(%error, "ollama pull failed");
            return Err(LlmError::BadResponse);
        }
        if let (Some(digest), Some(total)) = (line.digest, line.total) {
            // `completed` is absent until the layer starts moving.
            self.layers
                .insert(digest, (line.completed.unwrap_or(0).min(total), total));
        }
        if line.status.as_deref() == Some("success") {
            self.succeeded = true;
        }
        Ok(())
    }

    fn progress(&self) -> PullProgress {
        let (completed, total) = self.layers.values().fold((0u64, 0u64), |(c, t), (lc, lt)| {
            (c.saturating_add(*lc), t.saturating_add(*lt))
        });
        PullProgress { completed, total }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::Category;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    // ------------------------------------------------------- fake Ollama

    enum Reply {
        /// A complete response with a Content-Length.
        Full { status: u16, body: String },
        /// A 200 whose body is written in pieces and ended by closing the
        /// connection, the way `/api/pull` streams.
        Chunks(Vec<Vec<u8>>),
        /// Accept the request and never answer.
        Hang,
    }

    #[derive(Clone)]
    struct Seen {
        /// e.g. `POST /api/chat`
        route: String,
        body: String,
    }

    struct FakeOllama {
        base_url: String,
        seen: Arc<Mutex<Vec<Seen>>>,
    }

    impl FakeOllama {
        /// Serve `replies` in order, one connection each, on a loopback port.
        fn serve(replies: Vec<Reply>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let base_url = format!("http://{}", listener.local_addr().unwrap());
            let seen = Arc::new(Mutex::new(Vec::new()));
            let seen_in_thread = Arc::clone(&seen);

            std::thread::spawn(move || {
                let mut hung = Vec::new();
                for reply in replies {
                    let Ok((mut stream, _)) = listener.accept() else {
                        return;
                    };
                    seen_in_thread
                        .lock()
                        .unwrap()
                        .push(read_request(&mut stream));
                    match reply {
                        Reply::Full { status, body } => {
                            let _ = write!(
                                stream,
                                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\n\
                                 Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                                body.len()
                            );
                        }
                        Reply::Chunks(chunks) => {
                            let _ = write!(
                                stream,
                                "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\n\
                                 Connection: close\r\n\r\n"
                            );
                            for chunk in chunks {
                                let _ = stream.write_all(&chunk);
                                let _ = stream.flush();
                                std::thread::sleep(Duration::from_millis(5));
                            }
                        }
                        // Keep the socket open so the client waits, not fails.
                        Reply::Hang => hung.push(stream),
                    }
                }
                // Hold hung sockets until the test process exits.
                std::thread::sleep(Duration::from_secs(5));
                drop(hung);
            });

            Self { base_url, seen }
        }

        fn client(&self, model: &str) -> OllamaClient {
            OllamaClient::with_base_url(&self.base_url, model).unwrap()
        }

        fn seen(&self) -> Vec<Seen> {
            self.seen.lock().unwrap().clone()
        }
    }

    /// Read one HTTP/1.1 request: headers, then a Content-Length body.
    fn read_request(stream: &mut std::net::TcpStream) -> Seen {
        let mut raw = Vec::new();
        let mut byte = [0u8; 1];
        while !raw.ends_with(b"\r\n\r\n") {
            if stream.read(&mut byte).unwrap_or(0) == 0 {
                break;
            }
            raw.push(byte[0]);
        }
        let head = String::from_utf8_lossy(&raw).into_owned();
        let content_length = head
            .lines()
            .find_map(|l| {
                let (name, value) = l.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())?
            })
            .unwrap_or(0);
        let mut body = vec![0u8; content_length];
        let _ = stream.read_exact(&mut body);

        let request_line = head.lines().next().unwrap_or("");
        let route = request_line
            .rsplit_once(' ')
            .map_or(request_line, |(route, _version)| route);
        Seen {
            route: route.to_string(),
            body: String::from_utf8_lossy(&body).into_owned(),
        }
    }

    fn ok(body: serde_json::Value) -> Reply {
        Reply::Full {
            status: 200,
            body: body.to_string(),
        }
    }

    /// A port with nothing listening on it.
    fn dead_base_url() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        format!("http://{}", listener.local_addr().unwrap())
    }

    fn chat_reply(content: &str) -> Reply {
        ok(json!({
            "model": "gemma4:e4b",
            "message": { "role": "assistant", "content": content },
            "done": true,
        }))
    }

    // ------------------------------------------------------------ status

    #[test]
    fn test_normalize_model_name() {
        assert_eq!(normalize_model_name("gemma4"), "gemma4:latest");
        assert_eq!(normalize_model_name(" Gemma4 "), "gemma4:latest");
        assert_eq!(normalize_model_name("gemma4:E4B"), "gemma4:e4b");
        assert_eq!(
            normalize_model_name("localhost:5000/team/gemma4"),
            "localhost:5000/team/gemma4:latest"
        );
        assert_eq!(
            normalize_model_name("localhost:5000/team/gemma4:e4b"),
            "localhost:5000/team/gemma4:e4b"
        );
    }

    #[tokio::test]
    async fn test_status_ready_when_model_installed() {
        let fake = FakeOllama::serve(vec![ok(json!({
            "models": [
                { "name": "llama3.2:latest", "model": "llama3.2:latest" },
                { "name": "gemma4:e4b", "model": "gemma4:e4b" },
            ]
        }))]);

        let status = fake.client("Gemma4:E4B").status().await;
        assert_eq!(
            status,
            OllamaStatus {
                state: OllamaState::Ready,
                model: "Gemma4:E4B".to_string(),
                installed_models: vec!["llama3.2:latest".to_string(), "gemma4:e4b".to_string()],
            }
        );
        assert_eq!(fake.seen()[0].route, "GET /api/tags");
    }

    #[tokio::test]
    async fn test_status_bare_name_matches_latest_tag() {
        let fake = FakeOllama::serve(vec![ok(json!({
            "models": [{ "name": "gemma4:latest" }]
        }))]);
        assert_eq!(
            fake.client("gemma4").status().await.state,
            OllamaState::Ready
        );
    }

    #[tokio::test]
    async fn test_status_model_missing_still_lists_installed() {
        let fake = FakeOllama::serve(vec![ok(json!({
            "models": [{ "name": "gemma4:e2b" }]
        }))]);

        let status = fake.client("gemma4:e4b").status().await;
        assert_eq!(status.state, OllamaState::ModelMissing);
        assert_eq!(status.installed_models, vec!["gemma4:e2b".to_string()]);
    }

    #[tokio::test]
    async fn test_status_unreachable_cases() {
        // Nothing listening.
        let client = OllamaClient::with_base_url(&dead_base_url(), "gemma4:e4b").unwrap();
        assert_eq!(client.status().await.state, OllamaState::Unreachable);

        // Something else is on the port.
        let fake = FakeOllama::serve(vec![
            Reply::Full {
                status: 500,
                body: "{}".to_string(),
            },
            Reply::Full {
                status: 200,
                body: "<html>not ollama</html>".to_string(),
            },
        ]);
        let client = fake.client("gemma4:e4b");
        assert_eq!(client.status().await.state, OllamaState::Unreachable);
        assert_eq!(client.status().await.state, OllamaState::Unreachable);
    }

    #[test]
    fn test_status_serializes_camel_case() {
        let json = serde_json::to_value(OllamaStatus {
            state: OllamaState::ModelMissing,
            model: "gemma4:e4b".to_string(),
            installed_models: vec![],
        })
        .unwrap();
        assert_eq!(
            json,
            json!({ "state": "modelMissing", "model": "gemma4:e4b", "installedModels": [] })
        );
    }

    // ---------------------------------------------------------- classify

    #[tokio::test]
    async fn test_classify_round_trip() {
        let fake = FakeOllama::serve(vec![chat_reply(
            r#"{"category":"finance","likelyStillInUse":5,"reason":"Major bank."}"#,
        )]);
        let input = PromptInput::new("chase.com", Some("vish@example.com"));

        let analysis = fake.client("gemma4:e4b").classify(&input).await.unwrap();
        assert_eq!(
            analysis,
            AccountAnalysis {
                category: Category::Finance,
                likely_still_in_use: 5,
                reason: "Major bank.".to_string(),
            }
        );

        let seen = fake.seen();
        assert_eq!(seen[0].route, "POST /api/chat");
        let sent: serde_json::Value = serde_json::from_str(&seen[0].body).unwrap();
        assert_eq!(
            sent,
            json!({
                "model": "gemma4:e4b",
                "stream": false,
                "format": response_schema(),
                "options": { "temperature": 0, "num_predict": 96 },
                "keep_alive": "10m",
                "messages": [
                    { "role": "system", "content": system_prompt() },
                    {
                        "role": "user",
                        "content": "Domain: chase.com\nUsername: vish@example.com",
                    },
                ],
            })
        );
    }

    #[tokio::test]
    async fn test_classify_error_mapping() {
        let fake = FakeOllama::serve(vec![
            Reply::Full {
                status: 404,
                body: r#"{"error":"model 'gemma4:e4b' not found"}"#.to_string(),
            },
            Reply::Full {
                status: 500,
                body: r#"{"error":"boom"}"#.to_string(),
            },
            chat_reply("I think this is a bank."),
            ok(json!({ "done": true })),
        ]);
        let client = fake.client("gemma4:e4b");
        let input = PromptInput::new("example.com", None);

        assert!(matches!(
            client.classify(&input).await,
            Err(LlmError::ModelMissing { model }) if model == "gemma4:e4b"
        ));
        assert!(matches!(
            client.classify(&input).await,
            Err(LlmError::Http { status: 500 })
        ));
        // Reply text that is not JSON.
        assert!(matches!(
            client.classify(&input).await,
            Err(LlmError::BadResponse)
        ));
        // Envelope without a message.
        assert!(matches!(
            client.classify(&input).await,
            Err(LlmError::BadResponse)
        ));
    }

    #[tokio::test]
    async fn test_classify_unreachable_and_timeout() {
        let input = PromptInput::new("example.com", None);

        let client = OllamaClient::with_base_url(&dead_base_url(), "gemma4:e4b").unwrap();
        assert!(matches!(
            client.classify(&input).await,
            Err(LlmError::Unreachable)
        ));

        let fake = FakeOllama::serve(vec![Reply::Hang]);
        let mut client = fake.client("gemma4:e4b");
        client.chat_timeout = Duration::from_millis(100);
        assert!(matches!(
            client.classify(&input).await,
            Err(LlmError::Timeout)
        ));
    }

    // -------------------------------------------------------------- pull

    fn collect_progress() -> (
        Arc<Mutex<Vec<PullProgress>>>,
        impl Fn(PullProgress) + Send + Sync,
    ) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        (seen, move |p| sink.lock().unwrap().push(p))
    }

    #[tokio::test]
    async fn test_pull_sums_layers_across_split_lines() {
        // Two layers interleaved, with one line cut mid-way across chunks and
        // the final line missing its trailing newline.
        let fake = FakeOllama::serve(vec![Reply::Chunks(vec![
            b"{\"status\":\"pulling manifest\"}\n".to_vec(),
            b"{\"status\":\"pulling aaa\",\"digest\":\"sha256:aaa\",\"total\":100}\n\
              {\"status\":\"pulling bbb\",\"digest\":\"sha256:bbb\",\"to"
                .to_vec(),
            b"tal\":300,\"completed\":30}\n".to_vec(),
            b"{\"status\":\"pulling aaa\",\"digest\":\"sha256:aaa\",\"total\":100,\"completed\":100}\n\
              not json at all\n\
              {\"status\":\"pulling bbb\",\"digest\":\"sha256:bbb\",\"total\":300,\"completed\":300}\n"
                .to_vec(),
            b"{\"status\":\"verifying sha256 digest\"}\n{\"status\":\"success\"}".to_vec(),
        ])]);
        let (seen, on_progress) = collect_progress();

        fake.client("gemma4:e4b").pull(&on_progress).await.unwrap();

        // One report per line that moved the total, however the bytes were
        // chunked on the wire.
        let p = |completed, total| PullProgress { completed, total };
        assert_eq!(
            *seen.lock().unwrap(),
            vec![p(0, 100), p(30, 400), p(130, 400), p(400, 400)]
        );

        let sent: serde_json::Value = serde_json::from_str(&fake.seen()[0].body).unwrap();
        assert_eq!(fake.seen()[0].route, "POST /api/pull");
        assert_eq!(sent, json!({ "model": "gemma4:e4b", "stream": true }));
    }

    #[tokio::test]
    async fn test_pull_failures() {
        let fake = FakeOllama::serve(vec![
            // Ollama reports a bad model name as an error line in a 200.
            Reply::Chunks(vec![
                b"{\"status\":\"pulling manifest\"}\n".to_vec(),
                b"{\"error\":\"pull model manifest: file does not exist\"}\n".to_vec(),
            ]),
            // Connection closed before "success".
            Reply::Chunks(vec![
                b"{\"status\":\"pulling aaa\",\"digest\":\"sha256:aaa\",\"total\":100,\"completed\":40}\n"
                    .to_vec(),
            ]),
            Reply::Full {
                status: 500,
                body: "{}".to_string(),
            },
        ]);
        let client = fake.client("nope");
        let (_seen, on_progress) = collect_progress();

        assert!(matches!(
            client.pull(&on_progress).await,
            Err(LlmError::BadResponse)
        ));
        assert!(matches!(
            client.pull(&on_progress).await,
            Err(LlmError::BadResponse)
        ));
        assert!(matches!(
            client.pull(&on_progress).await,
            Err(LlmError::Http { status: 500 })
        ));

        let dead = OllamaClient::with_base_url(&dead_base_url(), "gemma4:e4b").unwrap();
        assert!(matches!(
            dead.pull(&on_progress).await,
            Err(LlmError::Unreachable)
        ));
    }

    #[test]
    fn test_pull_stream_rejects_endless_line() {
        let mut pull = PullStream::default();
        let junk = vec![b'x'; MAX_PULL_LINE_BYTES + 1];
        assert!(matches!(pull.feed(&junk), Err(LlmError::BadResponse)));
    }

    // -------------------------------------------------------------- live

    /// One real `/api/tags` and one real `/api/chat` round trip. Proves that
    /// Ollama accepts `response_schema()` as `format` and that the model's
    /// reply parses.
    ///
    /// Needs `ollama serve` with the default model pulled, so `#[ignore]`d.
    /// Run it with:
    ///
    /// ```sh
    /// cargo test --manifest-path src-tauri/Cargo.toml live_ollama -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "needs a running Ollama with the default model pulled"]
    async fn test_live_ollama_round_trip() {
        let client = OllamaClient::new(DEFAULT_MODEL).unwrap();

        let status = client.status().await;
        assert_eq!(
            status.state,
            OllamaState::Ready,
            "start `ollama serve` and `ollama pull {DEFAULT_MODEL}`; installed: {:?}",
            status.installed_models
        );

        let analysis = client
            .classify(&PromptInput::new("github.com", Some("octocat")))
            .await
            .expect("live classify failed");
        println!("live Ollama classify ok: {analysis:?}");
        assert_eq!(analysis.category, Category::Developer);
        assert!(!analysis.reason.is_empty());
    }
}
