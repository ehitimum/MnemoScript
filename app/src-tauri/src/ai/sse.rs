//! Minimal Server-Sent Events parser for the provider streaming APIs. Works on raw bytes so a
//! UTF-8 character split across network chunks is never corrupted.

#[derive(Debug, Clone, PartialEq)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

#[derive(Default)]
pub struct SseParser {
    buf: Vec<u8>,
}

impl SseParser {
    /// Feed a chunk; returns every event completed by it.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some((end, sep)) = find_boundary(&self.buf) {
            let block: Vec<u8> = self.buf.drain(..end + sep).collect();
            if let Some(ev) = parse_block(&String::from_utf8_lossy(&block[..end])) {
                out.push(ev);
            }
        }
        out
    }
}

/// Position of the first blank line (`\n\n` or `\r\n\r\n`) and its length.
fn find_boundary(buf: &[u8]) -> Option<(usize, usize)> {
    let lf = buf.windows(2).position(|w| w == b"\n\n").map(|p| (p, 2));
    let crlf = buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| (p, 4));
    match (lf, crlf) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
        (a, b) => a.or(b),
    }
}

fn parse_block(block: &str) -> Option<SseEvent> {
    let mut event = None;
    let mut data: Vec<&str> = Vec::new();
    for line in block.lines() {
        let line = line.trim_end_matches('\r');
        if line.starts_with(':') {
            continue; // comment / keep-alive
        }
        let (field, value) = match line.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (line, ""),
        };
        match field {
            "event" => event = Some(value.to_string()),
            "data" => data.push(value),
            _ => {}
        }
    }
    if data.is_empty() && event.is_none() {
        return None;
    }
    Some(SseEvent { event, data: data.join("\n") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_events_across_arbitrary_chunk_boundaries() {
        let raw = "event: message_start\ndata: {\"a\":1}\n\n: ping\n\ndata: {\"b\":\"é\"}\r\n\r\ndata: [DONE]\n\n";
        let bytes = raw.as_bytes();
        let mut p = SseParser::default();
        let mut events = Vec::new();
        // One byte at a time: splits the two-byte "é" and every separator.
        for b in bytes {
            events.extend(p.push(std::slice::from_ref(b)));
        }
        assert_eq!(events.len(), 3);
        assert_eq!(events[0], SseEvent { event: Some("message_start".into()), data: "{\"a\":1}".into() });
        assert_eq!(events[1].data, "{\"b\":\"é\"}");
        assert_eq!(events[2].data, "[DONE]");
    }

    #[test]
    fn joins_multi_line_data() {
        let mut p = SseParser::default();
        let ev = p.push(b"data: one\ndata: two\n\n");
        assert_eq!(ev[0].data, "one\ntwo");
    }
}
