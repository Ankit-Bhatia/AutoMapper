const SYNONYMS: Record<string, string[]> = {
  customer: ['cust', 'client', 'bp', 'businesspartner'],
  soldto: ['sold_to', 'sold-to', 'soldto'],
  shipto: ['ship_to', 'ship-to', 'shipto'],
  zipcode: ['postal', 'postalcode', 'zip'],
  address: ['addr', 'street', 'location'],
  externalid: ['customernumber', 'customerid', 'legacyid'],
  phone: ['telephone', 'tel'],
  name: ['name1', 'name2', 'fullname'],
};

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .flatMap((token) => [token, ...Object.entries(SYNONYMS)
      .filter(([, vals]) => vals.includes(token))
      .map(([key]) => key)]);
}

export function jaccard(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (!setA.size || !setB.size) return 0;
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

export function bestStringMatch(source: string, candidates: string[]): { index: number; score: number } {
  let best = { index: -1, score: 0 };
  candidates.forEach((candidate, index) => {
    const score = jaccard(source, candidate);
    if (score > best.score) {
      best = { index, score };
    }
  });
  return best;
}
