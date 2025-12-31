# 🤖 React Multi-Session AI Chatbot (with Gemini Nano)

Google Gemini API와 Chrome Built-in AI(Nano)를 활용한 멀티 세션 챗봇입니다.

## ✨ Key Features
- **Multi-Session**: 카카오톡 스타일의 UI, 여러 대화방 동시 운영 및 상태 관리.
- **Auto Failover System**: API 할당량 초과(429) 시 자동으로 모델 전환.
  - (Gemini 2.0 -> 2.0 Lite -> Pro -> ... -> **Local Nano**)
- **On-Device AI**: 서버가 죽거나 오프라인일 때 Chrome 내장 AI(Gemini Nano) 구동.
- **LocalStorage**: 별도 DB 없이 브라우저 저장소를 활용한 대화 영구 저장.

## 🛠 Tech Stack
- React (Vite)
- Google Generative AI SDK
- Chrome Prompt API (window.ai)
- CSS Flexbox (Responsive)

## 🚀 How to Run
1. Clone this repo
2. `npm install`
3. Set your API Key in `.env`
4. `npm run dev`
