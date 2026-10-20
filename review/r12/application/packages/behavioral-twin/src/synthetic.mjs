import {
  DISCOVERY_FIELDS,
  ONBOARDING_QUESTIONS,
  answerOnboardingQuestion,
  createTwinProfile,
  setDiscoveryEnabled,
  setFieldPermission,
} from './index.mjs';

export const SYNTHETIC_POPULATION_VERSION = 'BAARNE_SYNTHETIC_POPULATION_V1';

const ROLES = Object.freeze([
  'Traveler', 'Engineer', 'Entrepreneur', 'Researcher', 'Volunteer', 'Artist', 'Community organizer',
]);
const LABELS = Object.freeze([
  'Aylin — Sensor Engineer', 'Deniz — Solar Installer', 'Mira — Field Researcher', 'Tomas — Software Builder',
  'Lina — Community Organizer', 'Omar — Data Researcher', 'Iris — Visual Artist', 'Kai — Volunteer Coordinator',
  'Sofia — Traveling Translator', 'Emre — Local Food Founder', 'Nora — Accessibility Researcher', 'Leo — Fabrication Mentor',
  'Ada — Climate Writer', 'Ravi — Robotics Engineer', 'Mina — Fundraising Advisor', 'Jonas — Open Source Maintainer',
  'Selin — Education Volunteer', 'Amal — Community Facilitator', 'Clara — Field Logistics Planner', 'Noah — Solar Entrepreneur',
  'Ece — Storytelling Artist', 'Mateo — Remote Traveler', 'Layla — Research Methods Coach', 'Finn — Technical Writer',
  'Derya — Project Manager', 'Sam — Sensor Fabricator', 'Aya — Translation Volunteer', 'Pia — Graphic Designer',
  'Kerem — Local Organizer', 'Zoe — Data Analyst', 'Arda — Accessibility Builder', 'Maya — Climate Researcher',
  'Eli — Knowledge Exchange Host', 'Nadia — Solar Researcher', 'Theo — Community Founder', 'Lara — Open Source Artist',
  'Can — Field Engineer', 'June — Volunteer Researcher', 'Imani — Local Food Organizer', 'Alex — Remote Facilitator',
  'Yara — Education Designer', 'Mert — Robotics Mentor', 'Lucia — Mediterranean Traveler', 'Ben — Research Entrepreneur',
  'Sena — Community Writer', 'Hugo — Solar Fabricator', 'Rana — Field Translator', 'Milo — Accessibility Artist',
  'Aslı — Climate Organizer', 'Ivan — Software Volunteer',
]);

const pools = Object.freeze({
  interests: ['renewable-energy', 'remote-travel', 'open-source', 'community-building', 'visual-arts', 'education', 'climate-science', 'robotics', 'local-food', 'accessibility', 'field-research', 'storytelling'],
  skillsOffered: ['sensor-engineering', 'solar-installation', 'software-development', 'data-analysis', 'fundraising', 'project-management', 'field-logistics', 'translation', 'graphic-design', 'community-organizing', 'research-methods', 'facilitation', 'technical-writing', 'fabrication'],
  needs: ['sensor-monitoring', 'solar-expertise', 'software-prototype', 'data-analysis', 'fundraising', 'project-planning', 'field-logistics', 'translation', 'visual-identity', 'community-outreach', 'research-partner', 'facilitation', 'technical-writing', 'fabrication'],
  goals: ['launch-pilot', 'learn-new-skill', 'build-community', 'publish-research', 'reduce-environmental-impact', 'create-art', 'mentor-others', 'find-collaborator', 'share-knowledge', 'improve-accessibility'],
  collaborationStyles: ['async', 'scheduled-calls', 'hands-on', 'short-projects', 'long-term', 'knowledge-exchange'],
  communicationMethods: ['in-app', 'email-after-consent', 'video-after-consent'],
  languages: ['en', 'tr', 'es', 'fr', 'de', 'ar'],
  geography: ['remote', 'europe', 'mediterranean', 'global'],
  availability: ['weekdays', 'evenings', 'weekends', 'flexible', 'limited'],
});

function seedValue(seed) {
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value || 1;
}
function rng(seed) {
  let state = seedValue(seed);
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
const take = (source, random, count) => {
  const values = [...source];
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values.slice(0, count).sort();
};

function buildProfile(index, random, overrides = {}) {
  const userId = `synthetic:user-${String(index + 1).padStart(2, '0')}`;
  let profile = createTwinProfile({ userId, displayLabel: LABELS[index], now: 1 });
  const used = new Set();
  const generated = {
    interests: take(pools.interests, random, index % 9 === 0 ? 1 : 2),
    skillsOffered: take(pools.skillsOffered, random, index % 8 === 0 ? 1 : 2),
    needs: take(pools.needs, random, index % 7 === 0 ? 1 : 2),
    goals: take(pools.goals, random, 2),
    collaborationStyles: take(pools.collaborationStyles, random, 2),
    communicationMethods: ['in-app', ...(index % 3 ? ['email-after-consent'] : [])],
    languages: take(pools.languages, random, index % 5 === 0 ? 1 : 2),
    geography: index % 4 === 0 ? ['remote'] : take(pools.geography, random, 1),
    availability: take(pools.availability, random, 1),
    ...overrides,
  };
  let now = 2;
  for (const field of DISCOVERY_FIELDS) {
    if (!generated[field]?.length) continue;
    for (const item of ONBOARDING_QUESTIONS.filter(question => question.field === field)) {
      const values = generated[field].filter(value => item.options.includes(value));
      if (!values.length || used.has(item.id)) continue;
      used.add(item.id);
      profile = answerOnboardingQuestion(profile, { questionId: item.id, values, useForDiscovery: true, now: now++ });
    }
    profile = setFieldPermission(profile, { purpose: 'discovery', field, allowed: true, now: now++ });
    profile = setFieldPermission(profile, { purpose: 'introduction', field, allowed: ['communicationMethods', 'languages', 'availability', 'skillsOffered', 'goals'].includes(field), now: now++ });
  }
  return setDiscoveryEnabled(profile, { enabled: ![12, 26, 40].includes(index), now: now++ });
}

const SPECIAL = Object.freeze({
  0: { interests: ['renewable-energy', 'robotics'], skillsOffered: ['sensor-engineering'], needs: ['solar-expertise'], goals: ['launch-pilot', 'find-collaborator'], collaborationStyles: ['hands-on', 'short-projects'], communicationMethods: ['in-app', 'email-after-consent'], languages: ['tr', 'en'], geography: ['remote'], availability: ['weekends'] },
  1: { interests: ['renewable-energy', 'community-building'], skillsOffered: ['solar-installation'], needs: ['sensor-monitoring'], goals: ['launch-pilot', 'reduce-environmental-impact'], collaborationStyles: ['hands-on', 'short-projects'], communicationMethods: ['in-app', 'email-after-consent'], languages: ['tr', 'en'], geography: ['remote'], availability: ['weekends'] },
  2: { interests: ['field-research', 'climate-science'], skillsOffered: ['research-methods'], needs: ['field-logistics'], goals: ['publish-research', 'find-collaborator'], collaborationStyles: ['async', 'long-term'], communicationMethods: ['in-app'], languages: ['en'], geography: ['global'], availability: ['flexible'] },
  3: { interests: ['open-source', 'field-research'], skillsOffered: ['software-development'], needs: ['research-partner'], goals: ['launch-pilot', 'publish-research'], collaborationStyles: ['async', 'long-term'], communicationMethods: ['in-app'], languages: ['en'], geography: ['global'], availability: ['flexible'] },
  4: { interests: ['community-building', 'local-food'], skillsOffered: ['community-organizing'], needs: ['visual-identity'], goals: ['build-community', 'find-collaborator'], collaborationStyles: ['scheduled-calls', 'long-term'], communicationMethods: ['in-app'], languages: ['tr'], geography: ['local-only'], availability: ['evenings'] },
  6: { interests: ['visual-arts', 'storytelling'], skillsOffered: ['graphic-design'], needs: ['community-outreach'], goals: ['create-art', 'build-community'], collaborationStyles: ['scheduled-calls', 'short-projects'], communicationMethods: ['in-app'], languages: ['en', 'tr'], geography: ['remote'], availability: ['evenings'] },
  48: { interests: ['climate-science'], skillsOffered: [], needs: [], goals: ['learn-new-skill'], collaborationStyles: ['scheduled-calls'], communicationMethods: ['in-app'], languages: ['ar'], geography: ['local-only'], availability: ['limited'] },
});

export function createSyntheticPopulation({ seed = 'BAARNE-HUB-MVP-2026' } = {}) {
  const random = rng(seed);
  const profiles = LABELS.map((_, index) => buildProfile(index, random, SPECIAL[index] ?? {}));
  const metadata = LABELS.map((displayLabel, index) => Object.freeze({
    userId: `synthetic:user-${String(index + 1).padStart(2, '0')}`,
    displayLabel,
    domain: ROLES[index % ROLES.length],
    fictional: true,
  }));
  return Object.freeze({
    populationVersion: SYNTHETIC_POPULATION_VERSION,
    seed,
    profiles: Object.freeze(profiles),
    metadata: Object.freeze(metadata),
    predefinedScenarios: Object.freeze([
      { scenarioId: 'solar-sensor', focalUserId: 'synthetic:user-01', expectedUserId: 'synthetic:user-02', kind: 'strong-complementarity', explanation: 'Sensor monitoring and solar installation needs complement each other.' },
      { scenarioId: 'research-software', focalUserId: 'synthetic:user-03', expectedUserId: 'synthetic:user-04', kind: 'cross-disciplinary', explanation: 'Field research and software prototyping can support a research collaboration.' },
      { scenarioId: 'organizer-artist', focalUserId: 'synthetic:user-05', expectedUserId: 'synthetic:user-07', kind: 'cross-disciplinary', explanation: 'Community outreach and visual identity needs complement each other.' },
      { scenarioId: 'disabled-profile', focalUserId: 'synthetic:user-01', expectedUserId: 'synthetic:user-13', kind: 'privacy-blocked', explanation: 'Discovery-disabled profiles must not be recommended.' },
      { scenarioId: 'isolated-profile', focalUserId: 'synthetic:user-49', expectedUserId: null, kind: 'incomplete-isolated', explanation: 'Sparse and incompatible profile data should produce few or no recommendations.' },
    ]),
    interactionScenarios: Object.freeze([
      { scenarioId: 'mutual-introduction', actorUserId: 'synthetic:user-01', targetUserId: 'synthetic:user-02', expectedTerminalState: 'CONNECTED' },
      { scenarioId: 'rejected-introduction', actorUserId: 'synthetic:user-08', targetUserId: 'synthetic:user-10', expectedTerminalState: 'DECLINED' },
      { scenarioId: 'blocked-introduction', actorUserId: 'synthetic:user-09', targetUserId: 'synthetic:user-12', expectedTerminalState: 'BLOCKED' },
    ]),
  });
}
