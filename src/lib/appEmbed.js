export function isStaffAppEmbed(search) {
  const params = new URLSearchParams(search);
  return params.get('embed') === '1' && ['appSupport', 'appNorthbound', 'appInsurance', 'appOffers', 'appKnowledge', 'appPrompts'].includes(params.get('view'));
}
