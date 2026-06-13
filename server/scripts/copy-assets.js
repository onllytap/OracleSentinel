const fs = require("fs");
const path = require("path");

function copyRecursive(source, destination) {
  if (!fs.existsSync(source)) {
    return;
  }

  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const child of fs.readdirSync(source)) {
      copyRecursive(path.join(source, child), path.join(destination, child));
    }
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

copyRecursive("src/views", "dist/views");
copyRecursive("src/db/migrations", "dist/db/migrations");
console.log("Copied views + migrations to dist/");
