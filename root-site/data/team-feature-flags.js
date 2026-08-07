export function featureAiBatchForCompany(companies, activeCompanyId) {
  const companyId = String(activeCompanyId || "");
  if (!companyId || !Array.isArray(companies)) return false;
  const company = companies.find((entry) => String(entry?.id || "") === companyId);
  return company?.featureAiBatch === true;
}
