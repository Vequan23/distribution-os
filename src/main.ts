import { createApp } from "vue";
import { registerOsxComponents } from "osx-components";
import "osx-components/theme.css";
import App from "./App.vue";
import "./styles.css";

registerOsxComponents();
createApp(App).mount("#app");
