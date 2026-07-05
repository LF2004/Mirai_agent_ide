<script setup>
import { ref } from 'vue';

defineProps({
  mode: {
    type: String,
    default: 'agent'
  },
  model: {
    type: String,
    default: 'gpt-4.1'
  },
  currentFile: {
    type: String,
    default: ''
  }
});

defineEmits(['mode-change', 'model-change']);

const input = ref('');
const messages = ref([
  {
    role: 'assistant',
    title: 'Workspace ready',
    content: 'File operations and the editor are now the priority. The agent runtime can attach to this panel after the IDE shell feels right.'
  },
  {
    role: 'assistant',
    title: 'Current context',
    content: 'Open a file, edit it, save it, then use this panel later for task planning and code changes.'
  }
]);

function sendDraft() {
  const value = input.value.trim();

  if (!value) {
    return;
  }

  messages.value.push({
    role: 'user',
    title: 'You',
    content: value
  });

  messages.value.push({
    role: 'assistant',
    title: 'Agent',
    content: `Received: "${value}". Real model streaming and tool calls will plug into this message surface.`
  });

  input.value = '';
}
</script>

<template>
  <div class="panel agent-panel">
    <div class="agent-header">
      <div class="agent-header__title">
        <span class="codicon codicon-comment-discussion"></span>
        <span>@{{ currentFile }} continue...</span>
      </div>
      <div class="agent-header__actions">
        <button class="icon-button codicon codicon-add"></button>
        <button class="icon-button codicon codicon-history"></button>
        <button class="icon-button codicon codicon-ellipsis"></button>
      </div>
    </div>

    <div class="message-list agent-message-list">
      <article
        v-for="(message, index) in messages"
        :key="`${message.role}-${index}`"
        class="message-card"
        :class="`message-card--${message.role}`"
      >
        <strong>{{ message.title }}</strong>
        <p>{{ message.content }}</p>
      </article>
    </div>

    <div class="composer agent-composer">
      <textarea
        v-model="input"
        class="composer__input"
        rows="4"
        placeholder="Plan, build, / for skills, @ for context"
      ></textarea>
      <div class="composer__bar">
        <div class="composer__left">
          <select :value="mode" class="composer-pill" @change="$emit('mode-change', $event.target.value)">
            <option value="agent">Agent</option>
            <option value="plan">Plan</option>
            <option value="debug">Debug</option>
            <option value="multitask">Multitask</option>
            <option value="ask">Ask</option>
          </select>
          <select :value="model" class="composer-model" @change="$emit('model-change', $event.target.value)">
            <option value="gpt-4.1">GPT-4.1</option>
            <option value="gpt-4o">GPT-4o</option>
            <option value="claude-4-sonnet">Claude Sonnet</option>
          </select>
        </div>
        <div class="composer__right">
          <button class="icon-button codicon codicon-attach"></button>
          <button class="icon-button codicon codicon-mic"></button>
          <button class="primary-button composer__button" @click="sendDraft">Send</button>
        </div>
      </div>
    </div>
  </div>
</template>
