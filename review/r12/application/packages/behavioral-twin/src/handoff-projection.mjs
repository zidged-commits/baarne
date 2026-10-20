// Same minimized projection for native and browser owners; no crypto or storage.
import {validateTwinProfile,getIntroductionDisclosure,createTwinProfile,ONBOARDING_QUESTIONS,DISCOVERY_FIELDS} from './index.mjs';
export function projectIntroductionProfile(profile,fields){
  validateTwinProfile(profile);
  if(!Array.isArray(fields)||new Set(fields).size!==fields.length||fields.some(f=>!DISCOVERY_FIELDS.includes(f)))throw Error('INVALID_HANDOFF_FIELDS');
  const permitted=getIntroductionDisclosure(profile,fields),next=structuredClone(createTwinProfile({userId:profile.userId,displayLabel:'Synthetic introduction participant',now:profile.createdAt}));
  next.updatedAt=profile.updatedAt;
  for(const q of ONBOARDING_QUESTIONS){const answer=profile.answers[q.id];if(!answer||!fields.includes(q.field))continue;const values=answer.values.filter(v=>permitted[q.field].includes(v));if(values.length)next.answers[q.id]={values,useForDiscovery:false,updatedAt:answer.updatedAt};}
  for(const field of fields)next.fieldPermissions.introduction[field]=profile.fieldPermissions.introduction[field];
  return validateTwinProfile(next);
}
