// Dev utility: list uncovered lines/branches from coverage/coverage-final.json
const fs = require('fs');
const det = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
const FILTER =
  /differ|index-build|spec-loader|schema-differ|ignore|comparator|run\.ts|diff-command|validate-command|analyze|sort|hash|errors|loader\.ts|validate\.ts/;
for (const [file, cov] of Object.entries(det)) {
  const norm = file.split(/[\\/]/).join('/');
  const m = norm.match(/src\/(.*)$/);
  if (!m) continue;
  const p = 'src/' + m[1];
  if (!FILTER.test(p)) continue;
  const uncoveredS = [];
  const uncoveredB = [];
  for (const [id, count] of Object.entries(cov.s)) {
    if (count === 0) uncoveredS.push(cov.statementMap[id].start.line);
  }
  for (const [id, counts] of Object.entries(cov.b)) {
    counts.forEach((c, i) => {
      if (c === 0) {
        const bm = cov.branchMap[id];
        uncoveredB.push(bm.loc.start.line + '(' + (i === 0 ? 'T' : 'F') + ')');
      }
    });
  }
  const uniq = (a) => [...new Set(a)].sort((x, y) => x - y);
  const us = uniq(uncoveredS);
  const ub = uniq(uncoveredB);
  if (us.length || ub.length) {
    console.log(
      p +
        '\n  lines: ' +
        us.slice(0, 60).join(',') +
        (us.length > 60 ? '...' : '') +
        '\n  branches: ' +
        ub.slice(0, 80).join(',') +
        (ub.length > 80 ? '...' : ''),
    );
  }
}
