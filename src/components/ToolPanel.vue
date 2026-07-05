<script setup>
import { computed } from 'vue';

const props = defineProps({
  workspacePath: {
    type: String,
    default: ''
  },
  hasWorkspace: {
    type: Boolean,
    default: false
  }
});

const tools = computed(() => [
  {
    name: 'workspace.open',
    status: props.hasWorkspace ? 'ready' : 'idle',
    detail: props.hasWorkspace ? 'Workspace loaded' : 'Waiting for a project'
  },
  {
    name: 'workspace.readFile',
    status: props.hasWorkspace ? 'ready' : 'idle',
    detail: 'Read file content through the preload IPC bridge'
  },
  {
    name: 'workspace.writeFile',
    status: props.hasWorkspace ? 'ready' : 'idle',
    detail: 'Save Monaco editor changes back to disk'
  },
  {
    name: 'workspace.createFolder',
    status: props.hasWorkspace ? 'ready' : 'idle',
    detail: 'Create folders from Explorer toolbar or context menu'
  },
  {
    name: 'workspace.renameDelete',
    status: props.hasWorkspace ? 'ready' : 'idle',
    detail: 'Rename and delete files or folders with workspace path guards'
  },
  {
    name: 'agent.loop',
    status: 'todo',
    detail: 'Real LLM streaming and tool execution can attach here next'
  }
]);
</script>

<template>
  <div class="panel panel--tools">
    <div class="panel__header">
      <span>Tools</span>
    </div>

    <div class="tool-summary">
      <p>Workspace</p>
      <strong>{{ workspacePath || 'Not opened' }}</strong>
    </div>

    <div class="tool-list">
      <article v-for="tool in tools" :key="tool.name" class="tool-card">
        <div class="tool-card__top">
          <strong>{{ tool.name }}</strong>
          <span class="tool-badge" :class="`tool-badge--${tool.status}`">{{ tool.status }}</span>
        </div>
        <p>{{ tool.detail }}</p>
      </article>
    </div>
  </div>
</template>
