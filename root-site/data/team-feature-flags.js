export function featureAiBatchForCompany(companies, activeCompanyId, bindings) {
  const companyId = String(activeCompanyId || "");
  if (!companyId || !Array.isArray(companies) || !Array.isArray(bindings)) return false;
  const isMember = bindings.some((binding) => String(binding?.company_id || "") === companyId);
  if (!isMember) return false;
  const company = companies.find((entry) => String(entry?.id || "") === companyId);
  return company?.featureAiBatch === true;
}
