<template>
  <div class="welcome-overlay">
    <div class="welcome-card">
      <p class="welcome-card__eyebrow">Mirai Agent IDE</p>
      <h1>Build the core Agent IDE shell first</h1>
      <p>
        This MVP already includes the Electron desktop shell, a SQLite settings database,
        project management, a workspace file tree, the Monaco editor, and the right-side
        agent layout.
      </p>
      <div class="welcome-card__actions">
        <button class="primary-button" @click="$emit('open-project')">Open Project</button>
        <button class="ghost-button" @click="$emit('create-project')">New Project</button>
      </div>
    </div>
  </div>
</template>
