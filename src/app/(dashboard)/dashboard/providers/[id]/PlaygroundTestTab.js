"use client";

import { useState, useRef, useEffect } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import {
  buildAvailableModels,
  hasActiveConnection,
  streamChatCompletion,
} from "./playgroundUtils";

/**
 * Tab "Test" — chat sederhana untuk menguji model provider ini.
 * Diekstrak dari PlaygroundSection; perilaku 100% sama seperti sebelumnya.
 */
export default function PlaygroundTestTab({ providerId, providerAlias, models, customModels, disabledModelIds, connections, apiKey }) {
  const [selectedModel, setSelectedModel] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef(null);
  const scrollRef = useRef(null);

  // Daftar model: model provider + custom model, dikurangi yang di-disable.
  const availableModels = buildAvailableModels(models, customModels, disabledModelIds, providerAlias, providerId);

  useEffect(() => {
    if (!selectedModel && availableModels.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- disengaja: pilih model pertama saat daftar tersedia; jangan di-refactor
      setSelectedModel(availableModels[0].id);
    }
  }, [availableModels.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const hasConnection = hasActiveConnection(connections);

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || sending || !selectedModel) return;
    setError("");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const userMsg = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setDraft("");
    setSending(true);

    const assistantMsg = { role: "assistant", content: "" };
    setMessages([...nextMessages, assistantMsg]);

    try {
      const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      let fullText = "";
      await streamChatCompletion({
        url: "/api/v1/chat/completions",
        headers,
        body: {
          model: `${providerAlias}/${selectedModel}`,
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        },
        signal: abortRef.current.signal,
        onDelta: (delta) => {
          fullText += delta;
          const snapshot = fullText;
          setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: snapshot } : m)));
        },
        onNonStream: (fallback) => {
          setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: fallback } : m)));
        },
      });
    } catch (err) {
      if (err?.name === "AbortError") return;
      setError(err?.message || translate("Request failed"));
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <div className="flex gap-2">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={availableModels.length === 0}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none max-w-[240px]"
            aria-label={translate("Select model")}
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <Button size="sm" variant="secondary" icon="delete" onClick={() => { abortRef.current?.abort(); setMessages([]); setError(""); }} disabled={messages.length === 0 && !error}>
            {translate("Clear")}
          </Button>
        </div>
      </div>

      {!hasConnection && (
        <p className="mb-3 text-xs text-amber-500">
          {translate("Add a connection above to use the playground.")}
        </p>
      )}

      <div ref={scrollRef} className="mb-3 h-72 overflow-y-auto rounded-lg border border-border bg-black/[0.02] dark:bg-white/[0.02] p-3 flex flex-col gap-2">
        {messages.length === 0 && (
          <p className="m-auto text-sm text-text-muted">{translate("Send a message to test this provider.")}</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.role === "user" ? "self-end bg-primary/15 text-text-main" : "self-start bg-black/[0.04] dark:bg-white/[0.06] text-text-main"}`}>
            {m.content || (sending && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>

      {error && <p className="mb-2 text-xs text-red-500 break-words">{error}</p>}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder={translate("Type a message...")}
          disabled={sending || !selectedModel || !hasConnection}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
        />
        <Button size="sm" icon={sending ? "progress_activity" : "send"} onClick={sendMessage} disabled={sending || !draft.trim() || !selectedModel || !hasConnection}>
          {sending ? translate("Sending...") : translate("Send")}
        </Button>
      </div>
    </div>
  );
}

PlaygroundTestTab.propTypes = {
  providerId: PropTypes.string.isRequired,
  providerAlias: PropTypes.string.isRequired,
  models: PropTypes.arrayOf(PropTypes.object),
  customModels: PropTypes.arrayOf(PropTypes.object),
  disabledModelIds: PropTypes.arrayOf(PropTypes.string),
  connections: PropTypes.arrayOf(PropTypes.object),
  apiKey: PropTypes.string,
};
