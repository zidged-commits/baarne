export const BEHAVIORAL_TWIN_VERSION = 'BAARNE_BEHAVIORAL_TWIN_MVP_V1';
export const INTRODUCTION_VERSION = 'BAARNE_INTRODUCTION_MVP_V1';

export const DISCOVERY_FIELDS = Object.freeze([
  'interests', 'skillsOffered', 'needs', 'goals', 'collaborationStyles',
  'communicationMethods', 'languages', 'geography', 'availability',
]);

export const TAXONOMY = Object.freeze({
  interests: Object.freeze(['renewable-energy', 'remote-travel', 'open-source', 'community-building', 'visual-arts', 'education', 'climate-science', 'robotics', 'local-food', 'accessibility', 'field-research', 'storytelling']),
  skillsOffered: Object.freeze(['sensor-engineering', 'solar-installation', 'software-development', 'data-analysis', 'fundraising', 'project-management', 'field-logistics', 'translation', 'graphic-design', 'community-organizing', 'research-methods', 'facilitation', 'technical-writing', 'fabrication']),
  needs: Object.freeze(['sensor-monitoring', 'solar-expertise', 'software-prototype', 'data-analysis', 'fundraising', 'project-planning', 'field-logistics', 'translation', 'visual-identity', 'community-outreach', 'research-partner', 'facilitation', 'technical-writing', 'fabrication']),
  goals: Object.freeze(['launch-pilot', 'learn-new-skill', 'build-community', 'publish-research', 'reduce-environmental-impact', 'create-art', 'mentor-others', 'find-collaborator', 'share-knowledge', 'improve-accessibility']),
  collaborationStyles: Object.freeze(['async', 'scheduled-calls', 'hands-on', 'short-projects', 'long-term', 'knowledge-exchange']),
  communicationMethods: Object.freeze(['in-app', 'email-after-consent', 'video-after-consent', 'voice-after-consent']),
  languages: Object.freeze(['en', 'tr', 'es', 'fr', 'de', 'ar']),
  geography: Object.freeze(['remote', 'local-only', 'europe', 'mediterranean', 'global']),
  availability: Object.freeze(['weekdays', 'evenings', 'weekends', 'flexible', 'limited']),
});

const COMPLEMENTS = Object.freeze({
  'sensor-engineering': 'sensor-monitoring',
  'solar-installation': 'solar-expertise',
  'software-development': 'software-prototype',
  'data-analysis': 'data-analysis',
  fundraising: 'fundraising',
  'project-management': 'project-planning',
  'field-logistics': 'field-logistics',
  translation: 'translation',
  'graphic-design': 'visual-identity',
  'community-organizing': 'community-outreach',
  'research-methods': 'research-partner',
  facilitation: 'facilitation',
  'technical-writing': 'technical-writing',
  fabrication: 'fabrication',
});

const question = (id, category, prompt, field, options, followUpFor = null) => Object.freeze({ id, category, prompt, field, options: Object.freeze(options), optional: true, followUpFor });
export const ONBOARDING_QUESTIONS = Object.freeze([
  question('interest-topics', 'Interests and curiosity', 'Which topics pull your curiosity?', 'interests', ['renewable-energy', 'open-source', 'climate-science', 'robotics', 'accessibility']),
  question('interest-activities', 'Interests and curiosity', 'Which activities would you enjoy exploring with others?', 'interests', ['remote-travel', 'community-building', 'visual-arts', 'local-food', 'field-research', 'storytelling']),
  question('interest-learning', 'Interests and curiosity', 'What would you like to learn next?', 'goals', ['learn-new-skill', 'share-knowledge', 'mentor-others']),
  question('interest-place', 'Interests and curiosity', 'Where can discovery opportunities happen for you?', 'geography', ['remote', 'local-only', 'europe', 'mediterranean', 'global']),
  question('skill-technical', 'Skills and capabilities', 'Which practical or technical capabilities could you offer?', 'skillsOffered', ['sensor-engineering', 'solar-installation', 'software-development', 'data-analysis', 'fabrication']),
  question('skill-people', 'Skills and capabilities', 'Which people-facing capabilities could you offer?', 'skillsOffered', ['fundraising', 'project-management', 'translation', 'community-organizing', 'facilitation']),
  question('skill-creative', 'Skills and capabilities', 'Which research or creative capabilities could you offer?', 'skillsOffered', ['graphic-design', 'research-methods', 'technical-writing']),
  question('skill-share', 'Skills and capabilities', 'How would you like to use what you know?', 'goals', ['mentor-others', 'share-knowledge', 'find-collaborator']),
  question('need-build', 'Needs and challenges', 'What could help move a project forward?', 'needs', ['sensor-monitoring', 'solar-expertise', 'software-prototype', 'fabrication']),
  question('need-analysis', 'Needs and challenges', 'Where would specialist thinking help?', 'needs', ['data-analysis', 'research-partner', 'technical-writing']),
  question('need-organize', 'Needs and challenges', 'Which coordination support would be useful?', 'needs', ['fundraising', 'project-planning', 'field-logistics', 'community-outreach']),
  question('need-communicate', 'Needs and challenges', 'Which communication support would be useful?', 'needs', ['translation', 'visual-identity', 'facilitation']),
  question('goal-near', 'Goals and aspirations', 'What would you like to accomplish next?', 'goals', ['launch-pilot', 'publish-research', 'create-art', 'find-collaborator']),
  question('goal-impact', 'Goals and aspirations', 'What kind of contribution matters to you?', 'goals', ['reduce-environmental-impact', 'build-community', 'improve-accessibility']),
  question('goal-growth', 'Goals and aspirations', 'How would you like to grow with others?', 'goals', ['learn-new-skill', 'mentor-others', 'share-knowledge']),
  question('goal-format', 'Goals and aspirations', 'What kind of opportunity are you seeking?', 'goals', ['find-collaborator', 'launch-pilot', 'publish-research']),
  question('collab-style', 'Collaboration and interaction preferences', 'How do you prefer to collaborate?', 'collaborationStyles', ['async', 'scheduled-calls', 'hands-on', 'short-projects', 'long-term', 'knowledge-exchange']),
  question('collab-contact', 'Collaboration and interaction preferences', 'Which contact methods could you approve after mutual interest?', 'communicationMethods', ['in-app', 'email-after-consent', 'video-after-consent', 'voice-after-consent']),
  question('collab-language', 'Collaboration and interaction preferences', 'Which languages can you use for collaboration?', 'languages', ['en', 'tr', 'es', 'fr', 'de', 'ar']),
  question('collab-time', 'Collaboration and interaction preferences', 'When are you usually available?', 'availability', ['weekdays', 'evenings', 'weekends', 'flexible', 'limited']),
]);

export class BehavioralTwinError extends Error {
  constructor(code) { super(code); this.name = 'BehavioralTwinError'; this.code = code; }
}
const fail = code => { throw new BehavioralTwinError(code); };
const clone = value => structuredClone(value);
const freeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
const unique = values => [...new Set(values)].sort();
const asTime = value => Number.isSafeInteger(value) && value >= 0 ? value : fail('INVALID_TIMESTAMP');
const asUserId = value => typeof value === 'string' && /^synthetic:user-[0-9]{2}$/.test(value) ? value : fail('SYNTHETIC_ID_REQUIRED');
const asLabel = value => typeof value === 'string' && value.length >= 2 && value.length <= 80 && !/[<>]/.test(value) ? value : fail('INVALID_SYNTHETIC_LABEL');
const asActionId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9:|._-]{2,199}$/i.test(value) ? value : fail('INVALID_ACTION_ID');
const questionById = id => ONBOARDING_QUESTIONS.find(item => item.id === id) ?? fail('UNKNOWN_QUESTION');
const emptyPermissions = value => Object.fromEntries(DISCOVERY_FIELDS.map(field => [field, value]));
function checkedUpdateTime(profile, value) {
  const now = asTime(value);
  if (now < profile.updatedAt) fail('STALE_PROFILE_UPDATE');
  return now;
}

function validateValues(field, values) {
  if (!Array.isArray(values) || values.length > 12) fail('INVALID_ANSWER');
  const allowed = new Set(TAXONOMY[field]);
  const result = unique(values);
  if (result.some(value => typeof value !== 'string' || !allowed.has(value))) fail('INVALID_ANSWER');
  return result;
}

export function createTwinProfile({ userId, displayLabel, now = 0 }) {
  const createdAt = asTime(now);
  return freeze({
    profileVersion: BEHAVIORAL_TWIN_VERSION,
    userId: asUserId(userId),
    displayLabel: asLabel(displayLabel),
    syntheticOnly: true,
    status: 'ACTIVE',
    discoveryEnabled: false,
    answers: {},
    fieldPermissions: { discovery: emptyPermissions(false), introduction: emptyPermissions(false) },
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  });
}

export function answerOnboardingQuestion(profileInput, { questionId, values, useForDiscovery = false, now }) {
  const profile = validateTwinProfile(profileInput);
  if (profile.status !== 'ACTIVE') fail('PROFILE_INACTIVE');
  const item = questionById(questionId);
  const checked = validateValues(item.field, values);
  const updatedAt = checkedUpdateTime(profile, now);
  const output = clone(profile);
  output.answers[questionId] = { values: checked, useForDiscovery: Boolean(useForDiscovery), updatedAt };
  output.updatedAt = updatedAt;
  return freeze(output);
}

export function skipOnboardingQuestion(profileInput, { questionId, now }) {
  questionById(questionId);
  return answerOnboardingQuestion(profileInput, { questionId, values: [], useForDiscovery: false, now });
}

export function setAnswerDiscoveryApproval(profileInput, { questionId, approved, now }) {
  const profile = validateTwinProfile(profileInput);
  if (!Object.hasOwn(profile.answers, questionId)) fail('ANSWER_NOT_FOUND');
  const updatedAt = checkedUpdateTime(profile, now);
  const output = clone(profile);
  output.answers[questionId].useForDiscovery = Boolean(approved);
  output.answers[questionId].updatedAt = updatedAt;
  output.updatedAt = updatedAt;
  return freeze(output);
}

export function setFieldPermission(profileInput, { purpose, field, allowed, now }) {
  const profile = validateTwinProfile(profileInput);
  if (!['discovery', 'introduction'].includes(purpose) || !DISCOVERY_FIELDS.includes(field)) fail('INVALID_PERMISSION');
  if (profile.status !== 'ACTIVE') fail('PROFILE_INACTIVE');
  const updatedAt = checkedUpdateTime(profile, now);
  const output = clone(profile);
  output.fieldPermissions[purpose][field] = Boolean(allowed);
  output.updatedAt = updatedAt;
  return freeze(output);
}

export function setDiscoveryEnabled(profileInput, { enabled, now }) {
  const profile = validateTwinProfile(profileInput);
  if (profile.status !== 'ACTIVE') fail('PROFILE_INACTIVE');
  const updatedAt = checkedUpdateTime(profile, now);
  const output = clone(profile);
  output.discoveryEnabled = Boolean(enabled);
  output.updatedAt = updatedAt;
  return freeze(output);
}

export function deleteTwinProfile(profileInput, { now }) {
  const profile = validateTwinProfile(profileInput);
  if (profile.status === 'DELETED') return profile;
  const deletedAt = checkedUpdateTime(profile, now);
  const output = clone(profile);
  output.status = 'DELETED';
  output.discoveryEnabled = false;
  output.answers = {};
  output.fieldPermissions = { discovery: emptyPermissions(false), introduction: emptyPermissions(false) };
  output.updatedAt = deletedAt;
  output.deletedAt = deletedAt;
  return freeze(output);
}

export function onboardingProgress(profileInput) {
  const profile = validateTwinProfile(profileInput);
  const answered = ONBOARDING_QUESTIONS.filter(item => Object.hasOwn(profile.answers, item.id)).length;
  return freeze({ answered, total: ONBOARDING_QUESTIONS.length, percent: Math.floor(answered * 100 / ONBOARDING_QUESTIONS.length) });
}

export function nextOnboardingQuestions(profileInput, limit = 5) {
  const profile = validateTwinProfile(profileInput);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) fail('INVALID_LIMIT');
  const remaining = ONBOARDING_QUESTIONS.filter(item => !Object.hasOwn(profile.answers, item.id));
  const answeredFields = new Set(Object.keys(profile.answers).map(id => questionById(id).field));
  return freeze([...remaining].sort((a, b) => Number(answeredFields.has(b.field)) - Number(answeredFields.has(a.field)) || a.id.localeCompare(b.id)).slice(0, limit));
}

function attributesForPurpose(profile, purpose) {
  const attributes = Object.fromEntries(DISCOVERY_FIELDS.map(field => [field, []]));
  for (const [questionId, answer] of Object.entries(profile.answers)) {
    const item = questionById(questionId);
    const approved = purpose === 'discovery' ? answer.useForDiscovery && profile.fieldPermissions.discovery[item.field] : profile.fieldPermissions.introduction[item.field];
    if (approved) attributes[item.field].push(...answer.values);
  }
  return Object.fromEntries(DISCOVERY_FIELDS.map(field => [field, unique(attributes[field])]));
}

export function getDiscoveryProfile(profileInput) {
  const profile = validateTwinProfile(profileInput);
  const visible = profile.status === 'ACTIVE' && profile.discoveryEnabled;
  return freeze({
    profileVersion: profile.profileVersion,
    userId: profile.userId,
    displayLabel: profile.displayLabel,
    syntheticOnly: true,
    discoverable: visible,
    attributes: visible ? attributesForPurpose(profile, 'discovery') : Object.fromEntries(DISCOVERY_FIELDS.map(field => [field, []])),
    updatedAt: profile.updatedAt,
  });
}

export function getIntroductionDisclosure(profileInput, requestedFields) {
  const profile = validateTwinProfile(profileInput);
  if (profile.status !== 'ACTIVE') fail('PROFILE_INACTIVE');
  if (!Array.isArray(requestedFields) || requestedFields.some(field => !DISCOVERY_FIELDS.includes(field))) fail('INVALID_DISCLOSURE_REQUEST');
  const allowed = attributesForPurpose(profile, 'introduction');
  return freeze(Object.fromEntries(unique(requestedFields).map(field => [field, allowed[field]])));
}

export function validateTwinProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('MALFORMED_PROFILE');
  const keys = ['profileVersion', 'userId', 'displayLabel', 'syntheticOnly', 'status', 'discoveryEnabled', 'answers', 'fieldPermissions', 'createdAt', 'updatedAt', 'deletedAt'];
  if (Reflect.ownKeys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) fail('MALFORMED_PROFILE');
  if (input.profileVersion !== BEHAVIORAL_TWIN_VERSION || input.syntheticOnly !== true) fail('MALFORMED_PROFILE');
  asUserId(input.userId); asLabel(input.displayLabel); asTime(input.createdAt); asTime(input.updatedAt);
  if (input.updatedAt < input.createdAt || !['ACTIVE', 'DELETED'].includes(input.status) || typeof input.discoveryEnabled !== 'boolean') fail('MALFORMED_PROFILE');
  if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)) fail('MALFORMED_PROFILE');
  for (const [id, answer] of Object.entries(input.answers)) {
    const item = questionById(id);
    if (!answer || Reflect.ownKeys(answer).length !== 3 || typeof answer.useForDiscovery !== 'boolean') fail('MALFORMED_PROFILE');
    validateValues(item.field, answer.values); asTime(answer.updatedAt);
  }
  for (const purpose of ['discovery', 'introduction']) {
    const permissions = input.fieldPermissions?.[purpose];
    if (!permissions || Reflect.ownKeys(permissions).length !== DISCOVERY_FIELDS.length || DISCOVERY_FIELDS.some(field => typeof permissions[field] !== 'boolean')) fail('MALFORMED_PROFILE');
  }
  if (input.status === 'DELETED' && (input.discoveryEnabled || input.deletedAt === null || Object.keys(input.answers).length)) fail('MALFORMED_PROFILE');
  if (input.deletedAt !== null) asTime(input.deletedAt);
  return freeze(clone(input));
}

const intersect = (a, b) => a.filter(value => b.includes(value));
function pairId(a, b) { return [asUserId(a), asUserId(b)].sort().join('|'); }
function compatible(stylesA, stylesB) {
  if (!stylesA.length || !stylesB.length) return true;
  if (intersect(stylesA, stylesB).length) return true;
  return stylesA.includes('async') && stylesB.includes('knowledge-exchange') || stylesB.includes('async') && stylesA.includes('knowledge-exchange');
}
function geographyCompatible(a, b) {
  if (!a.length || !b.length) return true;
  if (a.includes('remote') || b.includes('remote') || a.includes('global') || b.includes('global')) return true;
  return intersect(a, b).length > 0;
}

export function scoreDiscoveryPair(leftInput, rightInput, { mode = 'combined' } = {}) {
  if (!['similarity', 'complementarity', 'combined'].includes(mode)) fail('INVALID_MATCHING_MODE');
  const left = getDiscoveryProfile(leftInput), right = getDiscoveryProfile(rightInput);
  if (!left.discoverable || !right.discoverable || left.userId === right.userId) return null;
  const a = left.attributes, b = right.attributes;
  if (a.languages.length && b.languages.length && !intersect(a.languages, b.languages).length) return null;
  if (!compatible(a.collaborationStyles, b.collaborationStyles) || !geographyCompatible(a.geography, b.geography)) return null;
  const sharedInterests = intersect(a.interests, b.interests);
  const sharedGoals = intersect(a.goals, b.goals);
  const aHelpsB = a.skillsOffered.filter(skill => b.needs.includes(COMPLEMENTS[skill]));
  const bHelpsA = b.skillsOffered.filter(skill => a.needs.includes(COMPLEMENTS[skill]));
  const sharedLanguages = intersect(a.languages, b.languages);
  const sharedAvailability = intersect(a.availability, b.availability);
  const sharedStyles = intersect(a.collaborationStyles, b.collaborationStyles);
  const similarity = sharedInterests.length * 4 + sharedGoals.length * 3;
  const complementarity = (aHelpsB.length + bHelpsA.length) * 8;
  const opportunity = sharedLanguages.length * 3 + sharedAvailability.length * 2 + sharedStyles.length * 2 + (geographyCompatible(a.geography, b.geography) ? 1 : 0);
  const score = mode === 'similarity' ? similarity : mode === 'complementarity' ? complementarity : similarity + complementarity + opportunity;
  if (score === 0 || mode === 'combined' && similarity + complementarity === 0) return null;
  const explanations = [];
  if (sharedInterests.length) explanations.push(`Both opted to share an interest in ${sharedInterests.slice(0, 2).join(' and ')}.`);
  if (aHelpsB.length) explanations.push(`${left.displayLabel} offers ${aHelpsB[0]}, which may help with ${right.displayLabel}'s shared need for ${COMPLEMENTS[aHelpsB[0]]}.`);
  if (bHelpsA.length) explanations.push(`${right.displayLabel} offers ${bHelpsA[0]}, which may help with ${left.displayLabel}'s shared need for ${COMPLEMENTS[bHelpsA[0]]}.`);
  if (sharedGoals.length) explanations.push(`Both chose the goal ${sharedGoals[0]}.`);
  if (sharedLanguages.length) explanations.push(`They can collaborate in ${sharedLanguages.slice(0, 2).join(' or ')}.`);
  return freeze({ pairId: pairId(left.userId, right.userId), leftUserId: left.userId, rightUserId: right.userId, mode, internalScore: score, similarity, complementarity, mutualOpportunity: opportunity, explanations, evidence: { sharedInterests, sharedGoals, aHelpsB, bHelpsA, sharedLanguages, sharedAvailability, sharedStyles } });
}

export function recommendPeople(userId, profileInputs, { mode = 'combined', limit = 10, blockedPairs = [] } = {}) {
  asUserId(userId);
  const profiles = profileInputs.map(validateTwinProfile);
  const source = profiles.find(profile => profile.userId === userId) ?? fail('PROFILE_NOT_FOUND');
  const blocked = new Set(blockedPairs);
  const recommendations = [];
  for (const target of profiles) {
    const id = pairId(userId, target.userId);
    if (target.userId === userId || blocked.has(id)) continue;
    const result = scoreDiscoveryPair(source, target, { mode });
    if (result) recommendations.push({ ...result, targetUserId: target.userId, targetLabel: target.displayLabel });
  }
  recommendations.sort((a, b) => b.internalScore - a.internalScore || b.complementarity - a.complementarity || a.targetUserId.localeCompare(b.targetUserId));
  return freeze(recommendations.slice(0, limit));
}

export const INTRODUCTION_STATES = Object.freeze(['DISCOVERED', 'INTEREST_EXPRESSED', 'MUTUAL_INTEREST', 'INTRODUCTION_APPROVED', 'CONNECTED', 'DECLINED', 'WITHDRAWN', 'BLOCKED']);
const terminal = new Set(['CONNECTED', 'DECLINED', 'WITHDRAWN', 'BLOCKED']);

export class IntroductionManager {
  #profiles;
  #records = new Map();
  #blocked = new Set();
  constructor(profileInputs, snapshot = null) {
    this.#profiles = new Map(profileInputs.map(item => { const profile = validateTwinProfile(item); return [profile.userId, profile]; }));
    if (snapshot) this.#restore(snapshot);
  }
  #actor(record, actorId) {
    asUserId(actorId);
    if (!record.participants.includes(actorId)) fail('UNAUTHORIZED_ACTOR');
    return actorId;
  }
  #active(userId) { return this.#profiles.get(userId)?.status === 'ACTIVE'; }
  #mutate(introductionId, actionId, actorId, operationName, operation) {
    const current = this.#records.get(introductionId) ?? fail('INTRODUCTION_NOT_FOUND');
    this.#actor(current, actorId);
    const checkedActionId = asActionId(actionId);
    const prior = current.actions.find(action => action.actionId === checkedActionId);
    if (prior) {
      if (prior.actorId !== actorId || prior.operation !== operationName) fail('DUPLICATE_ACTION_CONFLICT');
      return freeze(clone(current));
    }
    const draft = clone(current);
    operation(draft);
    draft.actions.push({ actionId: checkedActionId, actorId, operation: operationName, state: draft.state });
    this.#records.set(introductionId, freeze(draft));
    return freeze(clone(draft));
  }
  discover(leftUserId, rightUserId) {
    const id = pairId(leftUserId, rightUserId);
    if (!this.#active(leftUserId) || !this.#active(rightUserId)) fail('PROFILE_INACTIVE');
    if (this.#blocked.has(id)) fail('PAIR_BLOCKED');
    if (this.#records.has(id)) return freeze(clone(this.#records.get(id)));
    const record = freeze({ introductionVersion: INTRODUCTION_VERSION, introductionId: id, participants: id.split('|'), state: 'DISCOVERED', interests: [], approvals: [], connectedConfirmations: [], disclosures: {}, actions: [] });
    this.#records.set(id, record);
    return freeze(clone(record));
  }
  expressInterest(introductionId, actorId, actionId) {
    return this.#mutate(introductionId, actionId, actorId, 'EXPRESS_INTEREST', draft => {
      if (!this.#active(actorId) || terminal.has(draft.state) || !['DISCOVERED', 'INTEREST_EXPRESSED'].includes(draft.state)) fail('INVALID_INTRODUCTION_TRANSITION');
      if (!draft.interests.includes(actorId)) draft.interests.push(actorId);
      draft.interests.sort();
      draft.state = draft.interests.length === 2 ? 'MUTUAL_INTEREST' : 'INTEREST_EXPRESSED';
    });
  }
  approveIntroduction(introductionId, actorId, requestedFields, actionId) {
    return this.#mutate(introductionId, actionId, actorId, 'APPROVE_INTRODUCTION', draft => {
      if (draft.state !== 'MUTUAL_INTEREST') fail('INVALID_INTRODUCTION_TRANSITION');
      draft.disclosures[actorId] = getIntroductionDisclosure(this.#profiles.get(actorId), requestedFields);
      if (!draft.approvals.includes(actorId)) draft.approvals.push(actorId);
      draft.approvals.sort();
      if (draft.approvals.length === 2) draft.state = 'INTRODUCTION_APPROVED';
    });
  }
  confirmConnected(introductionId, actorId, actionId) {
    return this.#mutate(introductionId, actionId, actorId, 'CONFIRM_CONNECTED', draft => {
      if (draft.state !== 'INTRODUCTION_APPROVED') fail('INVALID_INTRODUCTION_TRANSITION');
      if (!draft.connectedConfirmations.includes(actorId)) draft.connectedConfirmations.push(actorId);
      draft.connectedConfirmations.sort();
      if (draft.connectedConfirmations.length === 2) draft.state = 'CONNECTED';
    });
  }
  decline(introductionId, actorId, actionId) {
    return this.#mutate(introductionId, actionId, actorId, 'DECLINE', draft => {
      if (terminal.has(draft.state)) fail('INVALID_INTRODUCTION_TRANSITION');
      draft.state = 'DECLINED'; draft.disclosures = {};
    });
  }
  withdraw(introductionId, actorId, actionId) {
    return this.#mutate(introductionId, actionId, actorId, 'WITHDRAW', draft => {
      if (!draft.interests.includes(actorId) || terminal.has(draft.state)) fail('INVALID_INTRODUCTION_TRANSITION');
      draft.state = 'WITHDRAWN'; draft.disclosures = {};
    });
  }
  block(introductionId, actorId, actionId) {
    const record = this.#mutate(introductionId, actionId, actorId, 'BLOCK', draft => { draft.state = 'BLOCKED'; draft.disclosures = {}; });
    this.#blocked.add(record.introductionId);
    return record;
  }
  deactivateProfile(profileInput, now) {
    const deleted = deleteTwinProfile(profileInput, { now });
    this.#profiles.set(deleted.userId, deleted);
    for (const [id, current] of this.#records) {
      if (!current.participants.includes(deleted.userId)) continue;
      const draft = clone(current);
      draft.disclosures = {};
      if (!terminal.has(draft.state)) draft.state = 'WITHDRAWN';
      this.#records.set(id, freeze(draft));
    }
    return deleted;
  }
  blockedPairs() { return freeze([...this.#blocked].sort()); }
  get(introductionId) { const value = this.#records.get(introductionId); return value ? freeze(clone(value)) : null; }
  snapshot() { return freeze({ introductionVersion: INTRODUCTION_VERSION, records: [...this.#records.values()].map(clone).sort((a, b) => a.introductionId.localeCompare(b.introductionId)), blockedPairs: this.blockedPairs() }); }
  #restore(snapshot) {
    if (!snapshot || snapshot.introductionVersion !== INTRODUCTION_VERSION || !Array.isArray(snapshot.records) || !Array.isArray(snapshot.blockedPairs)) fail('MALFORMED_INTRODUCTION_SNAPSHOT');
    for (const record of snapshot.records) {
      if (!Array.isArray(record.participants) || record.participants.length !== 2 || !record.participants.every(id => this.#profiles.has(id)) ||
          record.introductionId !== pairId(...record.participants) || !INTRODUCTION_STATES.includes(record.state) || this.#records.has(record.introductionId) ||
          !Array.isArray(record.actions) || record.actions.some(action => {
            try { asActionId(action.actionId); } catch { return true; }
            return !record.participants.includes(action.actorId) || typeof action.operation !== 'string';
          })) fail('MALFORMED_INTRODUCTION_SNAPSHOT');
      this.#records.set(record.introductionId, freeze(clone(record)));
    }
    snapshot.blockedPairs.forEach(id => {
      if (typeof id !== 'string' || !this.#records.has(id) || this.#records.get(id).state !== 'BLOCKED') fail('MALFORMED_INTRODUCTION_SNAPSHOT');
      this.#blocked.add(id);
    });
  }
}

export function assertNoCoreReferenceCreation(value) {
  const serialized = JSON.stringify(value);
  if (/BAARNE_REFERENCE_V1|referenceRecordHash|issuerSignature/.test(serialized)) fail('CORE_REFERENCE_BOUNDARY_VIOLATION');
  return true;
}
