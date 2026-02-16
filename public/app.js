const timeLeftEl = document.getElementById('timeLeft');
const userScoreEl = document.getElementById('userScore');
const llmScoreEl = document.getElementById('llmScore');
const statusEl = document.getElementById('status');

const startBtn = document.getElementById('startBtn');
const nextTurnBtn = document.getElementById('nextTurnBtn');

const webcam = document.getElementById('webcam');
const snapshot = document.getElementById('snapshot');
const captureBtn = document.getElementById('captureBtn');
const llmGuessEl = document.getElementById('llmGuess');
const llmCorrectBtn = document.getElementById('llmCorrectBtn');
const llmWrongBtn = document.getElementById('llmWrongBtn');

const generateSceneBtn = document.getElementById('generateSceneBtn');
const llmImage = document.getElementById('llmImage');
const userGuessInput = document.getElementById('userGuessInput');
const submitGuessBtn = document.getElementById('submitGuessBtn');
const guessResult = document.getElementById('guessResult');

let stream;
let timer;
let timeLeft = 60;
let userScore = 0;
let llmScore = 0;
let activeTurn = 'human';
let currentLlmImageTurnId = null;
let gameRunning = false;
let lockTurn = false;

function setStatus(text) {
  statusEl.textContent = text;
}

function updateScoreboard() {
  timeLeftEl.textContent = String(timeLeft);
  userScoreEl.textContent = String(userScore);
  llmScoreEl.textContent = String(llmScore);
}

function endGame() {
  clearInterval(timer);
  gameRunning = false;
  nextTurnBtn.disabled = true;
  captureBtn.disabled = true;
  generateSceneBtn.disabled = true;
  submitGuessBtn.disabled = true;
  llmCorrectBtn.disabled = true;
  llmWrongBtn.disabled = true;

  let result = 'It\'s a tie!';
  if (userScore > llmScore) result = '🎉 You win!';
  if (llmScore > userScore) result = '🤖 Gemini wins!';

  setStatus(`Game over — ${result}`);
}

async function startWebcam() {
  stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  webcam.srcObject = stream;
}

function switchTurn(turn) {
  activeTurn = turn;
  lockTurn = false;
  llmGuessEl.textContent = '—';
  guessResult.textContent = '';
  currentLlmImageTurnId = null;

  if (turn === 'human') {
    setStatus('Your turn: act something out, then capture a frame for Gemini to guess.');
    captureBtn.disabled = false;
    llmCorrectBtn.disabled = true;
    llmWrongBtn.disabled = true;
    generateSceneBtn.disabled = true;
    submitGuessBtn.disabled = true;
  } else {
    setStatus('Gemini turn: generate an image and type your guess.');
    captureBtn.disabled = true;
    llmCorrectBtn.disabled = true;
    llmWrongBtn.disabled = true;
    generateSceneBtn.disabled = false;
    submitGuessBtn.disabled = true;
  }
}

startBtn.addEventListener('click', async () => {
  if (gameRunning) return;

  try {
    await startWebcam();
  } catch (error) {
    setStatus('Camera access is required for your acting turn.');
    return;
  }

  gameRunning = true;
  userScore = 0;
  llmScore = 0;
  timeLeft = 60;
  updateScoreboard();

  startBtn.disabled = true;
  nextTurnBtn.disabled = false;

  switchTurn('human');

  timer = setInterval(() => {
    timeLeft -= 1;
    updateScoreboard();
    if (timeLeft <= 0) {
      endGame();
    }
  }, 1000);
});

nextTurnBtn.addEventListener('click', () => {
  if (!gameRunning || lockTurn) return;
  switchTurn(activeTurn === 'human' ? 'llm' : 'human');
});

captureBtn.addEventListener('click', async () => {
  if (!gameRunning || activeTurn !== 'human') return;
  lockTurn = true;
  captureBtn.disabled = true;

  const ctx = snapshot.getContext('2d');
  ctx.drawImage(webcam, 0, 0, snapshot.width, snapshot.height);
  const imageData = snapshot.toDataURL('image/jpeg', 0.9);

  setStatus('Gemini is guessing...');

  try {
    const response = await fetch('/api/llm-guess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');

    llmGuessEl.textContent = data.guess;
    llmCorrectBtn.disabled = false;
    llmWrongBtn.disabled = false;
    setStatus('Did Gemini get it right?');
  } catch (error) {
    setStatus(`Guess failed: ${error.message}`);
    lockTurn = false;
    captureBtn.disabled = false;
  }
});

llmCorrectBtn.addEventListener('click', () => {
  if (!gameRunning || activeTurn !== 'human') return;
  llmScore += 1;
  updateScoreboard();
  llmCorrectBtn.disabled = true;
  llmWrongBtn.disabled = true;
  setStatus('Point awarded to Gemini. Click Next Turn.');
});

llmWrongBtn.addEventListener('click', () => {
  if (!gameRunning || activeTurn !== 'human') return;
  llmCorrectBtn.disabled = true;
  llmWrongBtn.disabled = true;
  setStatus('No point this round. Click Next Turn.');
});

generateSceneBtn.addEventListener('click', async () => {
  if (!gameRunning || activeTurn !== 'llm') return;
  generateSceneBtn.disabled = true;
  setStatus('Gemini is acting (generating image)...');

  try {
    const response = await fetch('/api/llm-act', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');

    llmImage.src = data.imageData;
    currentLlmImageTurnId = data.turnId;
    submitGuessBtn.disabled = false;
    setStatus('Now type your guess for Gemini\'s scene.');
  } catch (error) {
    setStatus(`Image generation failed: ${error.message}`);
    generateSceneBtn.disabled = false;
  }
});

submitGuessBtn.addEventListener('click', async () => {
  if (!gameRunning || !currentLlmImageTurnId) return;
  const guess = userGuessInput.value.trim();
  if (!guess) return;

  submitGuessBtn.disabled = true;

  try {
    const response = await fetch('/api/judge-user-guess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId: currentLlmImageTurnId, guess })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');

    if (data.correct) {
      userScore += 1;
      guessResult.textContent = `✅ Correct! The answer was: ${data.answer}`;
    } else {
      guessResult.textContent = `❌ Not quite. The answer was: ${data.answer}`;
    }

    updateScoreboard();
    currentLlmImageTurnId = null;
    userGuessInput.value = '';
    setStatus('Round complete. Click Next Turn.');
  } catch (error) {
    submitGuessBtn.disabled = false;
    setStatus(`Could not score guess: ${error.message}`);
  }
});
