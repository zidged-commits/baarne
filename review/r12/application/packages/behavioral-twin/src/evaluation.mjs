import { recommendPeople } from './index.mjs';

export const EVALUATION_VERSION = 'BAARNE_BEHAVIORAL_TWIN_EVALUATION_V1';
const modes = Object.freeze(['similarity', 'complementarity', 'combined']);

function evaluateMode(population, mode) {
  const results = [];
  for (const scenario of population.predefinedScenarios) {
    const recommendations = recommendPeople(scenario.focalUserId, population.profiles, { mode, limit: 5 });
    const rank = scenario.expectedUserId === null ? null : recommendations.findIndex(item => item.targetUserId === scenario.expectedUserId) + 1 || null;
    results.push({ scenarioId: scenario.scenarioId, kind: scenario.kind, expectedUserId: scenario.expectedUserId, rank, recommendedUserIds: recommendations.map(item => item.targetUserId) });
  }
  const positive = results.filter(item => item.expectedUserId !== null && item.kind !== 'privacy-blocked');
  const hits = positive.filter(item => item.rank !== null).length;
  const privacyBlocked = results.filter(item => item.kind === 'privacy-blocked' && item.rank === null).length;
  const falsePositives = results.filter(item => item.kind === 'incomplete-isolated').reduce((total, item) => total + item.recommendedUserIds.length, 0);
  const domains = new Set();
  for (const result of results) for (const id of result.recommendedUserIds) {
    const record = population.metadata.find(item => item.userId === id);
    if (record) domains.add(record.domain);
  }
  return { mode, expectedScenarioHits: hits, expectedScenarioTotal: positive.length, privacyBlocked, isolatedProfileRecommendations: falsePositives, recommendationDomainDiversity: domains.size, scenarios: results };
}

export function evaluateMatchingStrategies(population) {
  function isDenseArray(arr) {
    return Array.isArray(arr)
      && arr.every((_, index) => Object.hasOwn(arr, index))
      && arr.length === arr.filter((_, index) => Object.hasOwn(arr, index)).length;
  }
  if (!isDenseArray(population?.profiles) || !isDenseArray(population?.predefinedScenarios) || !isDenseArray(population?.metadata)) throw new Error('INVALID_SYNTHETIC_POPULATION');
  const strategies = modes.map(mode => evaluateMode(population, mode));
  const repeated = modes.map(mode => JSON.stringify(evaluateMode(population, mode)));
  return Object.freeze({
    evaluationVersion: EVALUATION_VERSION,
    populationVersion: population.populationVersion,
    seed: population.seed,
    syntheticOnly: true,
    strategies,
    deterministicAcrossRepeatedRuns: repeated.every((value, index) => value === JSON.stringify(strategies[index])),
    interpretationLimits: Object.freeze([
      'SYNTHETIC_RELEVANCE_IS_NOT_USER_SATISFACTION',
      'NO_EMPIRICAL_ACCEPTANCE_RATE',
      'ONE_SYNTHETIC_IDENTITY_IS_NOT_ONE_PROVEN_HUMAN',
    ]),
  });
}
