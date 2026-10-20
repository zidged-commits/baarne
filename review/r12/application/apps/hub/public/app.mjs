import {
  DISCOVERY_FIELDS, IntroductionManager, ONBOARDING_QUESTIONS, answerOnboardingQuestion,
  deleteTwinProfile, getDiscoveryProfile, onboardingProgress, recommendPeople,
  setAnswerDiscoveryApproval, setDiscoveryEnabled, setFieldPermission, skipOnboardingQuestion,
} from '/domain/index.mjs';
import { createSyntheticPopulation } from '/domain/synthetic.mjs';
import { discoveryGuidance } from './discovery-guidance.mjs';

const STORAGE = 'baarne-hub-synthetic-v1';
const $ = id => document.getElementById(id);
const memoryStorage = new Map();
function selectStorage() {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // Sandboxed previews may deny localStorage; the demo still works in memory.
  }
  return {
    getItem: key => memoryStorage.get(key) ?? null,
    setItem: (key, value) => memoryStorage.set(key, value),
    removeItem: key => memoryStorage.delete(key),
  };
}
const storage = selectStorage();
const population = createSyntheticPopulation();
let profiles = [...population.profiles];
let currentUserId = 'synthetic:user-01';
let currentQuestion = 0;
let selected = null;
let manager;

function load() {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE));
    if (saved?.syntheticOnly === true && Array.isArray(saved.profiles)) profiles = saved.profiles;
    manager = new IntroductionManager(profiles, saved?.introductions ?? null);
  } catch { profiles = [...population.profiles]; manager = new IntroductionManager(profiles); }
}
function save() { storage.setItem(STORAGE, JSON.stringify({ syntheticOnly: true, profiles, introductions: manager.snapshot() })); }
function profile() { return profiles.find(item => item.userId === currentUserId); }
function replaceProfile(next) { profiles = profiles.map(item => item.userId === next.userId ? next : item); manager = new IntroductionManager(profiles, manager.snapshot()); save(); }
function toast(message, error = false) { const node = $('toast'); node.textContent = message; node.className = error ? 'show error' : 'show'; setTimeout(() => { node.className = ''; }, 2600); }
function attempt(fn) { try { fn(); } catch (error) { toast(error.code ?? error.message ?? 'Action failed', true); } }

function show(id) {
  document.querySelectorAll('.screen').forEach(node => node.classList.toggle('active', node.id === id));
  document.querySelectorAll('[data-nav]').forEach(node => node.classList.toggle('active', node.dataset.nav === id));
  if (id === 'onboarding') renderQuestion();
  if (id === 'profile') renderProfile();
  if (id === 'discover') renderRecommendations();
  if (id === 'request') renderRequest();
  if (id === 'mutual') renderIntroduction();
  if (id === 'privacy') renderPrivacy();
  globalThis.history?.replaceState(null, '', `#${id}`);
}

function renderQuestion() {
  const item = ONBOARDING_QUESTIONS[currentQuestion % ONBOARDING_QUESTIONS.length];
  const existing = profile().answers[item.id];
  const progress = onboardingProgress(profile());
  $('progress-label').textContent = `${progress.answered} / ${progress.total}`;
  $('progress-bar').style.width = `${progress.percent}%`;
  $('question-category').textContent = item.category;
  $('question-prompt').textContent = item.prompt;
  $('question-options').replaceChildren(...item.options.map(value => {
    const label = document.createElement('label');
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = value; input.checked = existing?.values.includes(value) ?? false;
    label.append(input, document.createTextNode(value.replaceAll('-', ' '))); return label;
  }));
  $('question-discovery').checked = existing?.useForDiscovery ?? false;
}

function saveQuestion(skip = false) {
  const item = ONBOARDING_QUESTIONS[currentQuestion % ONBOARDING_QUESTIONS.length];
  const now = Date.now();
  let next;
  if (skip) next = skipOnboardingQuestion(profile(), { questionId: item.id, now });
  else {
    const values = [...$('question-options').querySelectorAll('input:checked')].map(node => node.value);
    next = answerOnboardingQuestion(profile(), { questionId: item.id, values, useForDiscovery: $('question-discovery').checked, now });
    next = setFieldPermission(next, { purpose: 'discovery', field: item.field, allowed: true, now: now + 1 });
  }
  replaceProfile(next);
  if (currentQuestion === ONBOARDING_QUESTIONS.length - 1) {
    show('profile');
    return;
  }
  currentQuestion = (currentQuestion + 1) % ONBOARDING_QUESTIONS.length;
  renderQuestion();
}

function renderProfile() {
  const discovery = getDiscoveryProfile(profile());
  $('discovery-enabled').checked = discovery.discoverable;
  $('profile-fields').replaceChildren(...DISCOVERY_FIELDS.map(field => {
    const article = document.createElement('article'); article.className = `profile-field ${profile().fieldPermissions.discovery[field] ? '' : 'off'}`;
    const heading = document.createElement('h3'); heading.textContent = field.replace(/([A-Z])/g, ' $1');
    const tags = document.createElement('div'); tags.className = 'tags';
    const values = discovery.attributes[field]; tags.replaceChildren(...(values.length ? values : ['not shared']).map(value => { const span = document.createElement('span'); span.className = 'tag'; span.textContent = value.replaceAll('-', ' '); return span; }));
    const label = document.createElement('label'); label.className = 'approval';
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = profile().fieldPermissions.discovery[field];
    toggle.onchange = () => attempt(() => { replaceProfile(setFieldPermission(profile(), { purpose: 'discovery', field, allowed: toggle.checked, now: Date.now() })); renderProfile(); });
    label.append(toggle, document.createTextNode('Allow for discovery')); article.append(heading, tags, label); return article;
  }));
}

function recommendations() { return recommendPeople(currentUserId, profiles, { mode: $('matching-mode').value, blockedPairs: manager.blockedPairs(), limit: 12 }); }
function renderRecommendations() {
  const list = recommendations();
  $('recommendations').replaceChildren(...list.map(item => {
    const card = document.createElement('article'); card.className = 'match-card';
    const title = document.createElement('h3'); title.textContent = item.targetLabel;
    const why = document.createElement('div'); why.className = 'why'; why.append(...item.explanations.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
    const button = document.createElement('button'); button.className = 'primary'; button.textContent = 'Consider introduction';
    button.onclick = () => attempt(() => { selected = item; manager.discover(currentUserId, item.targetUserId); save(); show('request'); });
    card.append(title, why, button); return card;
  }));
  if (!list.length) {
    const current = profile();
    const approved = getDiscoveryProfile(current).attributes;
    const guidance = discoveryGuidance({
      status: current.status,
      discoveryEnabled: current.discoveryEnabled,
      hasApprovedInformation: Object.values(approved).some(values => values.length > 0),
    });
    const empty = document.createElement('div'); empty.className = 'empty-state';
    const message = document.createElement('p'); message.textContent = guidance.message;
    const button = document.createElement('button'); button.className = 'secondary';
    button.textContent = guidance.label;
    button.onclick = () => show(guidance.screen);
    empty.append(message, button);
    $('recommendations').replaceChildren(empty);
  }
}

function selectedRecord() { return selected ? manager.get(selected.pairId) : null; }
function renderRequest() {
  const record = selectedRecord();
  $('express-interest').disabled = !record;
  $('decline-match').disabled = !record;
  if (!record) { $('request-summary').textContent = 'Choose a recommendation first.'; return; }
  $('request-summary').replaceChildren(Object.assign(document.createElement('h3'), { textContent: selected.targetLabel }), ...selected.explanations.map(text => Object.assign(document.createElement('p'), { textContent: text })), Object.assign(document.createElement('p'), { textContent: `Current state: ${record.state}` }));
}

function actors() {
  if (!selected) return [];
  return [currentUserId, selected.targetUserId];
}
function renderIntroduction() {
  const record = selectedRecord();
let previousActor = $('demo-actor').value;
$('demo-actor').replaceChildren(...actors().map(id => { const option = document.createElement('option'); option.value = id; option.textContent = profiles.find(item => item.userId === id)?.displayLabel ?? id; return option; }));
if (actors().includes(previousActor)) { $('demo-actor').value = previousActor; }
  for (const id of ['other-interest', 'approve-introduction', 'confirm-connected']) $(id).disabled = !record;
  if (!record) { $('introduction-status').textContent = 'No introduction selected.'; return; }
if (['DECLINED','WITHDRAWN','BLOCKED'].includes(record.state)) { for (const id of ['other-interest','approve-introduction','confirm-connected']) document.getElementById(id).disabled = true; const p = document.createElement('p'); p.textContent = 'Introduction ' + record.state.toLowerCase() + '.'; document.getElementById('introduction-status').replaceChildren(p); return; }
  const stages = ['DISCOVERED', 'INTEREST_EXPRESSED', 'MUTUAL_INTEREST', 'INTRODUCTION_APPROVED', 'CONNECTED'];
  const current = Math.max(stages.indexOf(record.state), 0);
  $('introduction-status').replaceChildren(...stages.map((stage, index) => { const div = document.createElement('div'); div.className = 'stage'; const dot = document.createElement('b'); dot.textContent = index <= current ? '✓' : String(index + 1); div.append(dot, document.createTextNode(stage.replaceAll('_', ' '))); return div; }));
}

function actionId(name, actor) { return `${name}:${selected.pairId}:${actor}`; }
function currentActor() { return $('demo-actor').value || currentUserId; }
function updateIntro(record) { save(); toast(`Introduction state: ${record.state}`); renderIntroduction(); }

function renderPrivacy() {
  $('privacy-toggle').textContent = profile().discoveryEnabled ? 'Disable discovery' : 'Enable discovery';
  $('block-selected').disabled = !selectedRecord();
}

document.querySelectorAll('[data-nav]').forEach(button => button.addEventListener('click', () => show(button.dataset.nav)));
$('save-answer').onclick = () => attempt(() => saveQuestion(false));
$('skip-question').onclick = () => attempt(() => saveQuestion(true));
$('previous-question').onclick = () => { currentQuestion = (currentQuestion - 1 + ONBOARDING_QUESTIONS.length) % ONBOARDING_QUESTIONS.length; renderQuestion(); };
$('discovery-enabled').onchange = event => attempt(() => { replaceProfile(setDiscoveryEnabled(profile(), { enabled: event.target.checked, now: Date.now() })); renderProfile(); });
$('matching-mode').onchange = renderRecommendations;
$('express-interest').onclick = () => attempt(() => updateIntro(manager.expressInterest(selected.pairId, currentUserId, actionId('interest', currentUserId))));
$('decline-match').onclick = () => attempt(() => { updateIntro(manager.decline(selected.pairId, currentUserId, actionId('decline', currentUserId))); show('discover'); });
$('other-interest').onclick = () => attempt(() => { const other = selected.targetUserId; updateIntro(manager.expressInterest(selected.pairId, other, actionId('interest', other))); });
$('approve-introduction').onclick = () => attempt(() => { const actor = currentActor(); const fields = [...$('share-fields').querySelectorAll('input:checked')].map(node => node.value); updateIntro(manager.approveIntroduction(selected.pairId, actor, fields, actionId('approve', actor))); });
$('confirm-connected').onclick = () => attempt(() => { const actor = currentActor(); updateIntro(manager.confirmConnected(selected.pairId, actor, actionId('connect', actor))); });
$('privacy-toggle').onclick = () => attempt(() => { replaceProfile(setDiscoveryEnabled(profile(), { enabled: !profile().discoveryEnabled, now: Date.now() })); renderPrivacy(); });
$('block-selected').onclick = () => attempt(() => { updateIntro(manager.block(selected.pairId, currentUserId, actionId('block', currentUserId))); show('discover'); });
$('delete-profile').onclick = () => attempt(() => { const deleted = manager.deactivateProfile(profile(), Date.now()); profiles = profiles.map(item => item.userId === deleted.userId ? deleted : item); save(); renderPrivacy(); toast('Local twin deleted. Discovery and new introductions are disabled.'); });
$('reset-demo').onclick = () => { storage.removeItem(STORAGE); globalThis.location?.reload(); };

load();
show(globalThis.location?.hash.slice(1) || 'welcome');
document.documentElement.dataset.hubClient = 'ready';
