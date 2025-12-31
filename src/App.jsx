// src/App.jsx
import { useState, useRef, useEffect } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "./App.css";

const API_KEY = import.meta.env.VITE_API_KEY; // 또는 "YOUR_API_KEY_HERE"

function App() {
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [processingSessions, setProcessingSessions] = useState([]);

  const messagesEndRef = useRef(null);
  const currentSessionRef = useRef(null);

  // 🔄 [수정됨] 맨 마지막에 "gemini-nano" 추가!
  const MODELS_TO_TRY = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite-preview-02-05",
    "gemini-flash-latest",
    "gemini-pro-latest",
    "gemini-nano", // 🚀 [히든카드] 내 컴퓨터에서 직접 돌리는 무료 모델
  ];

  useEffect(() => {
    currentSessionRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    const savedSessions =
      JSON.parse(localStorage.getItem("chatSessions")) || [];
    setSessions(savedSessions);

    if (savedSessions.length > 0) {
      const lastSession = savedSessions[savedSessions.length - 1];
      loadSession(lastSession.id);
    } else {
      createNewSession();
    }
  }, []);

  useEffect(() => {
    if (currentSessionId === null) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentSessionId]);

  const isSessionLoading = (sessionId) => {
    return processingSessions.includes(sessionId);
  };

  const createNewSession = () => {
    const newId = Date.now();
    const newSession = { id: newId, title: "새로운 대화" };
    const updatedSessions = [...sessions, newSession];
    setSessions(updatedSessions);
    localStorage.setItem("chatSessions", JSON.stringify(updatedSessions));
    setCurrentSessionId(newId);
    setMessages([]);
  };

  const loadSession = (id) => {
    const savedMessages =
      JSON.parse(localStorage.getItem(`session_${id}`)) || [];
    setCurrentSessionId(id);
    setMessages(savedMessages);
  };

  const deleteSession = (e, id) => {
    e.stopPropagation();
    if (!window.confirm("이 대화를 삭제하시겠습니까?")) return;
    const updatedSessions = sessions.filter((s) => s.id !== id);
    setSessions(updatedSessions);
    localStorage.setItem("chatSessions", JSON.stringify(updatedSessions));
    localStorage.removeItem(`session_${id}`);
    const newDrafts = { ...drafts };
    delete newDrafts[id];
    setDrafts(newDrafts);
    if (id === currentSessionId) {
      if (updatedSessions.length > 0) {
        loadSession(updatedSessions[0].id);
      } else {
        createNewSession();
      }
    }
  };

  const handleInputChange = (e) => {
    if (currentSessionId === null) return;
    setDrafts((prev) => ({ ...prev, [currentSessionId]: e.target.value }));
  };

  const sendMessage = async () => {
    const currentInput = drafts[currentSessionId] || "";
    if (!currentInput.trim() || isSessionLoading(currentSessionId)) return;

    const targetSessionId = currentSessionId;
    const userText = currentInput;

    setDrafts((prev) => ({ ...prev, [targetSessionId]: "" }));

    if (targetSessionId === currentSessionRef.current) {
      setMessages((prev) => [...prev, { text: userText, isUser: true }]);
    }
    const currentHistory =
      JSON.parse(localStorage.getItem(`session_${targetSessionId}`)) || [];
    const updatedHistoryWithUser = [
      ...currentHistory,
      { text: userText, isUser: true },
    ];
    localStorage.setItem(
      `session_${targetSessionId}`,
      JSON.stringify(updatedHistoryWithUser)
    );

    if (currentHistory.length === 0) {
      const updatedSessions = sessions.map((s) =>
        s.id === targetSessionId
          ? { ...s, title: userText.substring(0, 15) + "..." }
          : s
      );
      setSessions(updatedSessions);
      localStorage.setItem("chatSessions", JSON.stringify(updatedSessions));
    }

    setProcessingSessions((prev) => [...prev, targetSessionId]);

    try {
      const genAI = new GoogleGenerativeAI(API_KEY);

      let finalResponseText = "";
      let successModel = "";

      for (const modelName of MODELS_TO_TRY) {
        try {
          console.log(`🤖 시도 중인 모델: ${modelName}`);

          // 🚀 [특수 처리] Gemini Nano (Local)
          if (modelName === "gemini-nano") {
            // 브라우저에 AI 기능이 있는지 확인 (window.ai)
            if (!window.ai || !window.ai.languageModel) {
              throw new Error(
                "브라우저 내장 AI(Nano)를 찾을 수 없습니다. (크롬 설정 필요)"
              );
            }

            // 내장 모델 세션 생성
            const capabilities = await window.ai.languageModel.capabilities();
            if (capabilities.available === "no") {
              throw new Error("현재 기기에서 AI 모델을 사용할 수 없습니다.");
            }

            const session = await window.ai.languageModel.create();

            // 스트리밍 방식이 아니면 그냥 결과를 기다림
            // (Nano는 prompt 함수를 사용)
            finalResponseText = await session.prompt(userText);
            successModel = "Gemini Nano (On-Device 🏠)";

            // 성공하면 로컬 세션 종료 (메모리 절약)
            session.destroy();
            break;
          }

          // ☁️ [일반 처리] Google Cloud API
          else {
            const model = genAI.getGenerativeModel({ model: modelName });

            // Nano가 아닌 경우만 history 변환
            const history = updatedHistoryWithUser.map((msg) => ({
              role: msg.isUser ? "user" : "model",
              parts: [{ text: msg.text }],
            }));

            const chat = model.startChat({ history: history.slice(0, -1) });
            const result = await chat.sendMessage(userText);
            const response = await result.response;

            finalResponseText = response.text();
            successModel = modelName;
            break;
          }
        } catch (innerError) {
          // 어떤 에러든 나면 다음 모델 시도
          console.warn(`❌ [${modelName}] 실패: ${innerError.message}`);
          continue;
        }
      }

      if (!finalResponseText) {
        throw new Error(
          "서버 할당량도 끝나고, 로컬 Nano 모델도 실행할 수 없습니다 ㅠㅠ"
        );
      }

      const responseWithFooter = `${finalResponseText}\n\nRunning on: ${successModel}`;

      const historyAfterWait =
        JSON.parse(localStorage.getItem(`session_${targetSessionId}`)) || [];
      const finalHistory = [
        ...historyAfterWait,
        { text: responseWithFooter, isUser: false },
      ];
      localStorage.setItem(
        `session_${targetSessionId}`,
        JSON.stringify(finalHistory)
      );

      if (targetSessionId === currentSessionRef.current) {
        setMessages(finalHistory);
      }
    } catch (error) {
      console.error(error);
      const errorText = `⚠️ 실패.\n\n[원인]: ${error.message}`;
      const historyAfterWait =
        JSON.parse(localStorage.getItem(`session_${targetSessionId}`)) || [];
      const errorHistory = [
        ...historyAfterWait,
        { text: errorText, isUser: false },
      ];
      localStorage.setItem(
        `session_${targetSessionId}`,
        JSON.stringify(errorHistory)
      );
      if (targetSessionId === currentSessionRef.current) {
        setMessages(errorHistory);
      }
    } finally {
      setProcessingSessions((prev) =>
        prev.filter((id) => id !== targetSessionId)
      );
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      sendMessage();
    } else if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      const val = drafts[currentSessionId] || "";
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const newVal = val.substring(0, start) + "\n" + val.substring(end);
      setDrafts((prev) => ({ ...prev, [currentSessionId]: newVal }));
      setTimeout(() => {
        e.target.selectionStart = e.target.selectionEnd = start + 1;
      }, 0);
    }
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <button className="new-chat-btn" onClick={createNewSession}>
          ➕ 새로운 대화
        </button>
        <div className="session-list">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`session-item ${
                currentSessionId === session.id ? "active" : ""
              }`}
              onClick={() => loadSession(session.id)}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  overflow: "hidden",
                }}
              >
                <span>{isSessionLoading(session.id) ? "⏳" : "💬"}</span>
                <span
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {session.title}
                </span>
              </div>
              <button
                className="delete-btn"
                onClick={(e) => deleteSession(e, session.id)}
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="main-chat">
        <div className="chat-header">
          {sessions.find((s) => s.id === currentSessionId)?.title ||
            "Gemini Chat"}
          {isSessionLoading(currentSessionId) && (
            <span
              style={{ fontSize: "12px", color: "blue", marginLeft: "10px" }}
            >
              {" "}
              (답변 작성 중...)
            </span>
          )}
        </div>
        <div className="chat-window">
          {messages.length === 0 ? (
            <div
              style={{ textAlign: "center", marginTop: "100px", color: "#ccc" }}
            >
              <h2>무엇을 도와드릴까요?</h2>
            </div>
          ) : (
            messages.map((msg, index) => (
              <div
                key={index}
                className={`message ${msg.isUser ? "user" : "ai"}`}
              >
                <span style={{ whiteSpace: "pre-wrap" }}>{msg.text}</span>
              </div>
            ))
          )}
          {isSessionLoading(currentSessionId) && (
            <div className="message ai">...</div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="input-area">
          <div className="input-wrapper">
            <textarea
              value={drafts[currentSessionId] || ""}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="메시지 보내기"
            />
            <button
              className="send-btn"
              onClick={sendMessage}
              disabled={isSessionLoading(currentSessionId)}
            >
              ➤
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
