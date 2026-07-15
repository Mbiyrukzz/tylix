import fs from "node:fs/promises";
import path from "node:path";

const STARTER_TEMPLATE = (name) => `page ${name}

state
  count: 0

computed
  doubled() {
    return this.count * 2
  }

action
  increment() {
    this.count = this.count + 1
  }

template
  <div>
    <h1>${name}</h1>
    <p>Count: {{ count }}, doubled: {{ doubled }}</p>
    <button onclick="{{ increment }}">+1</button>
  </div>

style
  h1 { font-family: sans-serif; }
`;

export async function makePage(name) {
  const baseDir = process.cwd();
  const pagesDir = path.join(baseDir, "app", "pages");
  await fs.mkdir(pagesDir, { recursive: true });

  const filePath = path.join(pagesDir, `${name}.tyx`);
  await fs.writeFile(filePath, STARTER_TEMPLATE(name));

  console.log(`\n✔ Page created: ${path.relative(baseDir, filePath)}\n`);
  console.log(`Run "tylix dev" and visit http://localhost:3000/${name.toLowerCase()} to see it.\n`);
}
