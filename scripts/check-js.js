// Syntax-check every shipped script so adding a module cannot skip validation.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
for (const directory of ['src', 'native-host', 'scripts']) {
  for (const name of fs.readdirSync(directory)) {
    if (name.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(directory, name)], {stdio:'inherit'});
  }
}
