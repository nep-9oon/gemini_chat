// src/App.jsx
import { useState, useRef, useEffect } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "./App.css";

// [설명] 환경변수 파일(.env)에서 API 키를 보안상 안전하게 가져옵니다.
const API_KEY = import.meta.env.VITE_API_KEY; // .evn 설정

function App() {
  /**
   * [State 관리]
   * sessions: 전체 대화방 목록을 저장하는 배열
   * currentSessionId: 현재 사용자가 보고 있는 대화방의 ID
   * messages: 현재 대화방의 주고받은 메시지 내역
   * drafts: 각 대화방별로 작성 중이던 입력값을 따로 저장 (멀티태스킹 지원)
   * processingSessions: 현재 AI가 답변을 생성 중인 대화방 ID 목록 (중복 전송 방지)
   */
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [processingSessions, setProcessingSessions] = useState([]);

  /**
   * [Ref 관리]
   * messagesEndRef: 채팅이 길어질 때 자동으로 맨 아래로 스크롤하기 위한 참조
   * currentSessionRef: 비동기 함수(sendMessage) 실행 도중 현재 보고 있는 방이 바뀌었는지 체크하기 위한 참조
   */
  const messagesEndRef = useRef(null);
  const currentSessionRef = useRef(null);

  // 아래 model들로 시도
  const MODELS_TO_TRY = [
    "gemini-2.0-flash", // 1순위: 최신 모델
    "gemini-2.0-flash-lite-preview-02-05", // 2순위: 경량화 모델
    "gemini-flash-latest", // 3순위: 이전 Flash 모델
    "gemini-pro-latest", // 4순위: Pro 모델
    "gemini-nano", // 일일 사용 가능 토큰이 떨어졌을 경우 chrome에서 지원하는 LOCAL LLM 사용을 위해 추가. 그러나 chrome 카나리아 버전에서도 사용 안됨. 일부 미국 지역에서만 사용 가능한 것으로 추정
  ];

  // 세션으로 관리하기 위해 추가
  // [설명] State인 currentSessionId를 Ref에 동기화하여, 비동기 함수 내에서도 최신 값을 참조할 수 있게 함
  useEffect(() => {
    currentSessionRef.current = currentSessionId;
  }, [currentSessionId]);

  // [설명] 앱 초기 실행 시 LocalStorage에서 저장된 대화방 목록을 불러오는 초기화 로직
  useEffect(() => {
    const savedSessions =
      JSON.parse(localStorage.getItem("chatSessions")) || [];
    setSessions(savedSessions);

    if (savedSessions.length > 0) {
      // 저장된 세션이 있다면 가장 마지막에 대화한 방을 엽니다.
      const lastSession = savedSessions[savedSessions.length - 1];
      loadSession(lastSession.id);
    } else {
      // 저장된 세션이 없다면 새로운 대화방을 자동으로 생성합니다.
      createNewSession();
    }
  }, []);

  // [설명] 메시지가 추가되거나 방이 바뀔 때마다 스크롤을 맨 아래로 이동 (사용자 편의성)
  useEffect(() => {
    if (currentSessionId === null) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentSessionId]);

  // [설명] 특정 세션이 현재 '답변 생성 중'인지 확인하는 헬퍼 함수
  const isSessionLoading = (sessionId) => {
    return processingSessions.includes(sessionId);
  };

  /**
   * [함수] createNewSession
   * 새로운 대화방 객체를 생성하고 State와 LocalStorage에 저장합니다.
   */
  const createNewSession = () => {
    const newId = Date.now(); // 현재 시간을 고유 ID로 사용
    const newSession = { id: newId, title: "새로운 대화" };

    const updatedSessions = [...sessions, newSession];
    setSessions(updatedSessions);
    localStorage.setItem("chatSessions", JSON.stringify(updatedSessions));

    setCurrentSessionId(newId);
    setMessages([]); // 새 방이므로 메시지 목록 초기화
  };

  /**
   * [함수] loadSession
   * 특정 ID의 대화방 데이터를 LocalStorage에서 불러와 화면에 표시합니다.
   */
  const loadSession = (id) => {
    const savedMessages =
      JSON.parse(localStorage.getItem(`session_${id}`)) || [];
    setCurrentSessionId(id);
    setMessages(savedMessages);
  };

  /**
   * [함수] deleteSession
   * 특정 대화방을 삭제하고 관련 데이터를 정리합니다.
   */
  const deleteSession = (e, id) => {
    e.stopPropagation(); // 버튼 클릭 시 부모 요소(세션 선택)로 이벤트가 전파되는 것을 방지
    if (!window.confirm("이 대화를 삭제하시겠습니까?")) return;

    // 1. 목록에서 해당 세션 제거
    const updatedSessions = sessions.filter((s) => s.id !== id);
    setSessions(updatedSessions);
    localStorage.setItem("chatSessions", JSON.stringify(updatedSessions));

    // 2. 해당 세션의 메시지 데이터 삭제
    localStorage.removeItem(`session_${id}`);

    // 3. 해당 세션의 작성 중이던 임시 텍스트(draft) 삭제
    const newDrafts = { ...drafts };
    delete newDrafts[id];
    setDrafts(newDrafts);

    // 4. 현재 보고 있던 방을 삭제했다면 다른 방으로 이동
    if (id === currentSessionId) {
      if (updatedSessions.length > 0) {
        loadSession(updatedSessions[0].id);
      } else {
        createNewSession();
      }
    }
  };

  // [설명] 입력창의 값을 State(drafts)에 실시간으로 반영
  const handleInputChange = (e) => {
    if (currentSessionId === null) return;
    setDrafts((prev) => ({ ...prev, [currentSessionId]: e.target.value }));
  };

  /**
   * [함수] sendMessage
   * 사용자의 메시지를 전송하고, 여러 모델을 순차적으로 시도(Failover)하여 응답을 받아옵니다.
   */
  const sendMessage = async () => {
    const currentInput = drafts[currentSessionId] || "";
    // 빈 메시지거나 이미 답변 생성 중이라면 실행하지 않음
    if (!currentInput.trim() || isSessionLoading(currentSessionId)) return;

    const targetSessionId = currentSessionId; // 함수 실행 시점의 세션 ID 저장
    const userText = currentInput;

    // 1. 입력창 초기화
    setDrafts((prev) => ({ ...prev, [targetSessionId]: "" }));

    // 2. 현재 보고 있는 방이라면 화면에 즉시 사용자 메시지 표시
    if (targetSessionId === currentSessionRef.current) {
      setMessages((prev) => [...prev, { text: userText, isUser: true }]);
    }

    // 3. LocalStorage에 사용자 메시지 저장
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

    // 4. 첫 메시지일 경우, 대화방 제목을 메시지 내용으로 자동 변경
    if (currentHistory.length === 0) {
      const updatedSessions = sessions.map((s) =>
        s.id === targetSessionId
          ? { ...s, title: userText.substring(0, 15) + "..." }
          : s
      );
      setSessions(updatedSessions);
      localStorage.setItem("chatSessions", JSON.stringify(updatedSessions));
    }

    // 5. 로딩 상태 시작 (중복 요청 방지)
    setProcessingSessions((prev) => [...prev, targetSessionId]);

    try {
      const genAI = new GoogleGenerativeAI(API_KEY);

      let finalResponseText = "";
      let successModel = "";

      // [설명] 모델 리스트를 순회하며 순차적으로 요청 시도 (Failover 로직)
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
            break; // 성공했으므로 루프 종료
          }

          //  [일반 처리] Google Cloud API
          else {
            const model = genAI.getGenerativeModel({ model: modelName });

            // Nano가 아닌 경우만 history 변환
            // (API 스펙에 맞춰 role과 parts 구조로 변환)
            const history = updatedHistoryWithUser.map((msg) => ({
              role: msg.isUser ? "user" : "model",
              parts: [{ text: msg.text }],
            }));

            // 채팅 시작 및 메시지 전송
            const chat = model.startChat({ history: history.slice(0, -1) });
            const result = await chat.sendMessage(userText);
            const response = await result.response;

            finalResponseText = response.text();
            successModel = modelName;
            break; // 성공했으므로 루프 종료
          }
        } catch (innerError) {
          // 어떤 에러든 나면 다음 모델 시도
          console.warn(`❌ [${modelName}] 실패: ${innerError.message}`);
          continue; // 다음 for문으로 이동하여 다음 모델 시도
        }
      }

      // 모든 모델에서 에러발생(혹은 토큰 사용량 초과) 시 final 처리
      if (!finalResponseText) {
        throw new Error(
          "서버 할당량도 끝나고, 로컬 Nano 모델도 실행할 수 없습니다 ㅠㅠ"
        );
      }

      // [설명] 어떤 모델이 답변했는지 꼬리말 추가
      const responseWithFooter = `${finalResponseText}\n\nRunning on: ${successModel}`;

      // 6. 응답 메시지 저장
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

      // 7. 현재 사용자가 아직 그 방을 보고 있다면 화면 업데이트
      if (targetSessionId === currentSessionRef.current) {
        setMessages(finalHistory);
      }
    } catch (error) {
      //디버깅을 위한 로그 추가
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
      // [설명] 로딩 상태 해제 (다시 메시지 전송 가능 상태로 변경)
      setProcessingSessions((prev) =>
        prev.filter((id) => id !== targetSessionId)
      );
    }
  };

  /**
   * [함수] handleKeyDown
   * 엔터키 입력 시 메시지 전송, Ctrl+Enter 시 줄바꿈 처리
   */
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      if (e.nativeEvent.isComposing) return; // 한글 조합 중 중복 전송 방지
      e.preventDefault();
      sendMessage();
    } else if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      // 커서 위치에 줄바꿈 문자(\n) 삽입 로직
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

  //화면단
  return (
    <div className="app-container">
      {/* 1. 사이드바 영역: 대화방 목록 표시 */}
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
                {/* 로딩 중이면 모래시계, 아니면 말풍선 아이콘 */}
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
      {/* 2. 메인 채팅 영역 */}
      <div className="main-chat">
        <div className="chat-header">
          {sessions.find((s) => s.id === currentSessionId)?.title ||
            "Gemini Chat"}
          {/* 답변 생성 중일 때 헤더에 표시 */}
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
          {/* 채팅창 내부의 로딩 인디케이터(...) */}
          {isSessionLoading(currentSessionId) && (
            <div className="message ai">...</div>
          )}
          {/* 자동 스크롤을 위한 더미 요소 */}
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
