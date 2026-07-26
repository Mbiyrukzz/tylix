# Tylix

> **Build Full-Stack JavaScript Applications**

Tylix is a batteries-included full-stack JavaScript framework with its own reactive compiler, generator-first CLI, database-agnostic ORM, authentication, routing, and developer tooling.

---

## Why Tylix?

Modern web development often means assembling multiple frameworks and libraries before you can build your first feature.

With Tylix, everything works together out of the box.

* ⚡ Reactive compiler
* 🚀 Generator-first CLI
* 🗄️ Database-agnostic ORM
* 🔐 Built-in Authentication
* 📄 File-based Pages
* 🔥 Hot Module Reload
* 📦 Feature Generator
* 🩺 Doctor Command
* 🖥️ Interactive Tinker
* 🛠️ Built-in Migrations
* 📧 Mail Support
* 🧩 Component System
* 📡 REST API Ready

---

# Installation

```bash
npm create tylix@latest
```

or

```bash
npx create-tylix@latest
```

Follow the interactive installer.

Choose:

* JavaScript or TypeScript
* SQLite, MySQL, PostgreSQL or MongoDB
* Authentication
* Styling
* Starter Template
* Package Manager

---

# Start Development

```bash
cd my-app

npm install

tylix dev
```

Visit

```
http://localhost:3000
```

---

# Example Page

```tyx
page Home

state
  count: 0

computed
  doubled() {
    return this.count * 2
  }

action
  increment() {
    this.count++
  }

template
  <div>

    <h1>Counter</h1>

    <p>
      Count: {{ count }}
    </p>

    <p>
      Doubled: {{ doubled }}
    </p>

    <button onclick="{{ increment }}">
      Increment
    </button>

  </div>
```

---

# Generate a Feature

```bash
tylix make:feature Post title:string body:text
```

Generates

```
app/
├── controllers/
│   └── PostController.js
│
├── models/
│   └── Post.js
│
├── validators/
│   └── PostValidator.js
│
└── Features/
    └── Post/
        └── feature.json

database/
└── migrations/
```

The generated feature is immediately usable.

---

# ORM

```javascript
const posts = await Post.query()
    .where("published", true)
    .orderBy("created_at", "DESC")
    .limit(10)
    .get();
```

Supports

* SQLite
* MySQL
* PostgreSQL
* MongoDB

---

# Authentication

Enable authentication during project creation and Tylix automatically generates:

```
Models
├── User
├── RefreshToken
└── PasswordReset

Controllers
└── AuthController

Validators
└── AuthValidator

Mailer
└── mailer.js
```

API

```
POST   /api/register
POST   /api/login
POST   /api/auth/logout
POST   /api/auth/refresh
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
GET    /api/auth/verify-email
GET    /api/me
```

Features included

* JWT Authentication
* Refresh Tokens
* Email Verification
* Password Reset
* Protected Routes
* Middleware

---

# File-Based Pages

```
app/pages/

Home.tyx
Login.tyx
Register.tyx
Dashboard.tyx
```

Automatically becomes

```
/
/home
/login
/register
/dashboard
```

No route configuration required.

---

# CLI

```bash
tylix make:page Dashboard

tylix make:feature User

tylix make:model Product

tylix make:controller Product

tylix make:migration create_products_table

tylix migrate

tylix doctor

tylix tinker

tylix dev
```

---

# Project Structure

```
app/

├── controllers/
├── Features/
├── layouts/
├── mail/
├── middleware/
├── models/
├── pages/
├── routes/
├── validators/

database/

├── migrations/
└── seeders/

public/

storage/

tylix.config.js
```

---

# Hot Module Reload

Simply save a file.

The browser updates automatically.

No refresh.

No restart.

---

# Built-in Developer Tools

```
✓ Compiler

✓ ORM

✓ Routing

✓ Authentication

✓ Migrations

✓ Feature Generator

✓ Doctor

✓ Tinker

✓ Scheduler

✓ Mail

✓ Hot Reload
```

---

# Philosophy

### Convention over Configuration

Focus on building features instead of configuring tooling.

### Batteries Included

Everything needed for modern full-stack development ships with the framework.

### Developer Experience

Fast feedback, helpful tooling, and minimal boilerplate.

### Performance

Compile first.

Run fast.

Ship less JavaScript.

---

# Roadmap

## Completed

* Reactive Compiler
* Template Compiler
* Reactive Runtime
* ORM
* Authentication
* Feature Generator
* File-Based Routing
* Hot Module Reload
* Doctor Command
* Interactive Tinker
* SQLite Support
* MySQL Support
* PostgreSQL Support
* MongoDB Support

## Planned

* Server Side Rendering (SSR)
* Static Site Generation (SSG)
* Official Component Library
* Plugin System
* DevTools
* Testing Framework
* VS Code Extension
* Deployment Adapters
* Cloud Platform
* Package Registry

---

# Contributing

```bash
git clone https://github.com/Mbiyrukzz/tylix.git

cd tylix

npm install

npm test
```

Contributions, ideas, and bug reports are welcome.

---

# License

MIT License

---

## Why Choose Tylix?

| Feature              | Tylix |
| -------------------- | ----- |
| Reactive Compiler    | ✅     |
| Full-Stack Framework | ✅     |
| Built-in ORM         | ✅     |
| Authentication       | ✅     |
| Feature Generator    | ✅     |
| File-Based Pages     | ✅     |
| Hot Reload           | ✅     |
| CLI                  | ✅     |
| Migrations           | ✅     |
| Doctor Command       | ✅     |
| Interactive Tinker   | ✅     |
| Multiple Databases   | ✅     |

---

## Current Status

Tylix is under active development and is already capable of building real-world full-stack applications.

The goal of the project is to provide a single, cohesive framework that eliminates the need to combine multiple libraries while maintaining excellent developer experience and high performance.

---

⭐ **If you like the project, consider giving it a star on GitHub. It helps others discover Tylix and supports its development.**
