export function discoveryGuidance({ status, discoveryEnabled, hasApprovedInformation }) {
  if (status === 'DELETED') {
    return { message: 'Your local twin was deleted', label: 'Open privacy', screen: 'privacy' };
  } else if (!discoveryEnabled) {
    return { message: 'Discovery is off', label: 'Review discovery settings', screen: 'profile' };
  } else if (!hasApprovedInformation) {
    return { message: 'No discovery-approved information', label: 'Build your twin', screen: 'onboarding' };
  } else {
    return { message: 'No suitable match', label: 'Review your profile', screen: 'profile' };
  }
}
