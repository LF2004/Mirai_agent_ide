import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@vscode/codicons/dist/codicon.css';
import App from './App.vue';
import './styles/base.css';

const app = createApp(App);
app.use(createPinia());
app.mount('#app');
