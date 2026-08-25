import { createApp } from "vue";
import { registerOsxComponents } from "osx-components";
import "osx-components/theme.css";
import MarketingApp from "./MarketingApp.vue";
import "./marketing.css";

registerOsxComponents();
createApp(MarketingApp).mount("#app");
