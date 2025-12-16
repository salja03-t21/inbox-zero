const fs = require('fs');

// Read the file
let content = fs.readFileSync('apps/web/app/(app)/accounts/AddAccount.tsx', 'utf8');

// Remove the billing message paragraph
content = content.replace(
  `        <TypographyP className="text-sm">
          You will be billed for each additional account
        </TypographyP>`,
  ''
);

// Write the file back
fs.writeFileSync('apps/web/app/(app)/accounts/AddAccount.tsx', content);
console.log('Removed billing message from AddAccount component');
