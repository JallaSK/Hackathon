const API_BASE_URL = 'http://localhost:3000';
const form = document.querySelector('#generate-form');
const promptField = document.querySelector('#prompt');
const charCount = document.querySelector('#char-count');
const generateButton = document.querySelector('#generate-button');
const quizButton = document.querySelector('#quiz-button');
const loading = document.querySelector('#loading');
const loadingLabel = document.querySelector('#loading-label');
const errorBox = document.querySelector('#error');
const outputSection = document.querySelector('#output-section');
const outputTitle = document.querySelector('#output-title');
const output = document.querySelector('#output');
const historyList = document.querySelector('#history-list');
const clearHistoryButton = document.querySelector('#clear-history');
const historyStorageKey = 'generationHistory';
const maxHistoryEntries = 20;
let isGenerating = false;

refreshHistory().catch(() => {
  showError('Could not load saved history. Check the extension storage permission.');
});

promptField.addEventListener('input', () => {
  charCount.textContent = `${promptField.value.length.toLocaleString()} / 10,000`;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isGenerating) return;

  const mode = event.submitter?.dataset.mode === 'quiz' ? 'quiz' : 'response';
  const prompt = promptField.value.trim();
  if (!prompt) {
    showError('Enter a prompt before generating a response.');
    promptField.focus();
    return;
  }

  isGenerating = true;
  generateButton.disabled = true;
  quizButton.disabled = true;
  loading.hidden = false;
  loadingLabel.textContent = mode === 'quiz' ? 'Creating your MCQ quiz…' : 'Thinking through it…';
  errorBox.hidden = true;
  outputSection.hidden = true;

  try {
    const response = await fetch(`${API_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, mode }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `The backend returned an error (${response.status}).`);
    }
    if (mode === 'quiz') {
      if (!Array.isArray(payload.quiz?.questions) || payload.quiz.questions.length < 5) {
        throw new Error('The backend did not return a complete quiz. Please try again.');
      }
      renderQuiz(payload.quiz);
    } else {
      if (typeof payload.response !== 'string' || !payload.response.trim()) {
        throw new Error('The backend returned an empty response. Please try again.');
      }
      output.textContent = payload.response;
    }
    outputTitle.textContent = mode === 'quiz' ? 'MCQ Quiz' : 'Response';
    outputSection.hidden = false;
    await saveHistory({
      id: crypto.randomUUID(),
      prompt,
      mode,
      createdAt: Date.now(),
      ...(mode === 'quiz' ? { quiz: payload.quiz } : { response: payload.response }),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      showError('Could not reach the local backend. Start it with npm start and check the extension origin in backend/.env.');
    } else {
      showError(error.message || 'Something went wrong. Please try again.');
    }
  } finally {
    loading.hidden = true;
    generateButton.disabled = false;
    quizButton.disabled = false;
    isGenerating = false;
  }
});

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

async function refreshHistory() {
  const stored = await chrome.storage.local.get(historyStorageKey);
  renderHistory(Array.isArray(stored[historyStorageKey]) ? stored[historyStorageKey] : []);
}

async function saveHistory(entry) {
  try {
    const stored = await chrome.storage.local.get(historyStorageKey);
    const previousEntries = Array.isArray(stored[historyStorageKey]) ? stored[historyStorageKey] : [];
    const entries = [entry, ...previousEntries].slice(0, maxHistoryEntries);
    await chrome.storage.local.set({ [historyStorageKey]: entries });
    renderHistory(entries);
  } catch {
    showError('Response generated, but it could not be saved to history.');
  }
}

function renderHistory(entries) {
  historyList.replaceChildren();
  clearHistoryButton.disabled = entries.length === 0;

  if (entries.length === 0) {
    const emptyState = document.createElement('p');
    emptyState.className = 'history-empty';
    emptyState.textContent = 'Your generated responses and quizzes will appear here.';
    historyList.append(emptyState);
    return;
  }

  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    button.addEventListener('click', () => openHistoryEntry(entry));

    const metadata = document.createElement('span');
    metadata.className = 'history-metadata';
    const mode = document.createElement('strong');
    mode.textContent = entry.mode === 'quiz' ? 'MCQ Quiz' : 'Response';
    const date = document.createElement('time');
    date.textContent = new Date(entry.createdAt).toLocaleString();
    metadata.append(mode, date);

    const prompt = document.createElement('span');
    prompt.className = 'history-prompt';
    prompt.textContent = entry.prompt;
    button.append(metadata, prompt);
    historyList.append(button);
  }
}

function openHistoryEntry(entry) {
  promptField.value = entry.prompt;
  charCount.textContent = `${promptField.value.length.toLocaleString()} / 10,000`;
  outputTitle.textContent = entry.mode === 'quiz' ? 'MCQ Quiz' : 'Response';
  if (entry.mode === 'quiz' && entry.quiz?.questions) {
    renderQuiz(entry.quiz);
  } else {
    output.textContent = entry.response ?? 'This older quiz was saved as text and cannot be scored interactively.';
  }
  outputSection.hidden = false;
  errorBox.hidden = true;
}

clearHistoryButton.addEventListener('click', async () => {
  try {
    await chrome.storage.local.remove(historyStorageKey);
    renderHistory([]);
  } catch {
    showError('Could not clear saved history. Please try again.');
  }
});

function renderQuiz(quiz) {
  output.replaceChildren();
  const questions = quiz.questions;
  const quizId = crypto.randomUUID();
  const progress = document.createElement('p');
  progress.className = 'quiz-progress';
  let answeredCount = 0;
  let score = 0;

  const updateProgress = () => {
    progress.textContent = `Answered ${answeredCount} of ${questions.length} · Score ${score}/${questions.length}`;
  };
  updateProgress();
  output.append(progress);

  questions.forEach((question, index) => {
    const card = document.createElement('article');
    card.className = 'quiz-question';

    const heading = document.createElement('h3');
    heading.textContent = `Question ${index + 1}`;
    const prompt = document.createElement('p');
    prompt.className = 'quiz-question-text';
    prompt.textContent = question.question;

    const options = document.createElement('div');
    options.className = 'quiz-options';
    const inputName = `quiz-${quizId}-question-${index}`;
    const radios = [];
    let checkButton;

    for (const letter of ['A', 'B', 'C', 'D']) {
      const label = document.createElement('label');
      label.className = 'quiz-option';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = inputName;
      radio.value = letter;
      radio.addEventListener('change', () => { checkButton.disabled = false; });
      const optionText = document.createElement('span');
      optionText.textContent = `${letter}. ${question.options[letter]}`;
      label.append(radio, optionText);
      options.append(label);
      radios.push({ radio, label });
    }

    const feedback = document.createElement('p');
    feedback.className = 'quiz-feedback';
    feedback.setAttribute('aria-live', 'polite');
    feedback.hidden = true;

    checkButton = document.createElement('button');
    checkButton.type = 'button';
    checkButton.className = 'check-answer';
    checkButton.textContent = 'Check answer';
    checkButton.disabled = true;
    checkButton.addEventListener('click', () => {
      const selected = radios.find(({ radio }) => radio.checked)?.radio.value;
      if (!selected) return;

      const isCorrect = selected === question.answer;
      if (isCorrect) score += 1;
      answeredCount += 1;
      radios.forEach(({ radio, label }) => {
        radio.disabled = true;
        if (radio.value === question.answer) label.classList.add('is-correct');
        if (radio.checked && !isCorrect) label.classList.add('is-incorrect');
      });
      feedback.textContent = isCorrect
        ? `Correct! ${question.explanation ?? ''}`.trim()
        : `Not quite. The correct answer is ${question.answer}. ${question.explanation ?? ''}`.trim();
      feedback.classList.add(isCorrect ? 'feedback-correct' : 'feedback-incorrect');
      feedback.hidden = false;
      checkButton.disabled = true;
      checkButton.textContent = 'Answered';
      updateProgress();

      if (answeredCount === questions.length) {
        const complete = document.createElement('p');
        complete.className = 'quiz-complete';
        complete.textContent = `Quiz complete. Your score: ${score} out of ${questions.length}.`;
        output.append(complete);
      }
    });

    card.append(heading, prompt, options, checkButton, feedback);
    output.append(card);
  });
}
