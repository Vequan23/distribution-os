<script setup lang="ts">
const loopSteps = [
  { id: "truth", title: "Add a project brief", detail: "Cite the sources that explain what you built.", state: "done" },
  { id: "signal", title: "Review a real signal", detail: "Choose which audience observations can inform a plan.", state: "done" },
  { id: "move", title: "Review one recommendation", detail: "Check its sources, channel, and draft before approval.", state: "active" },
  { id: "learn", title: "Save the result", detail: "Use what happened to improve the next plan.", state: "pending" },
];

const systemLayers = [
  { icon: "book", number: "01", title: "Add your project", copy: "Start with a repository, URL, document, or pasted notes. Distribution OS cites the sources behind your project brief." },
  { icon: "search", number: "02", title: "Review signals", copy: "Import public observations from GitHub or DEV. Nothing affects a plan until you accept it." },
  { icon: "sparkle", number: "03", title: "Review recommendations", copy: "Get a short list of useful actions. Each one includes its sources, channel, reason, and editable draft." },
  { icon: "activity", number: "04", title: "Save results", copy: "Approve, publish, and record what happened. Distribution OS uses those results in the next plan." },
];

const ecosystem = [
  { mark: "A", name: "Aperta", label: "Code comprehension", copy: "Turn AI-generated code into evidence-backed understanding and durable ownership.", href: "https://aperta-six.vercel.app/", action: "Explore Aperta", tone: "info", trackingId: "distribution-site-aperta" },
  { mark: "O", name: "OSX Components", label: "Interface system", copy: "Accessible Vue-authored web components for product interfaces with classic OS X clarity.", href: "https://osx-components.vercel.app/", action: "Browse components", tone: "warning", trackingId: "distribution-site-osx-components" },
  { mark: "V", name: "VQ Clark", label: "Builder notes", copy: "Engineering, architecture, product systems, and the thinking behind this ecosystem.", href: "https://vqclark.vercel.app/", action: "Read the journal", tone: "neutral", trackingId: "distribution-site-vqclark" },
];

function scrollToId(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openWorkspace(): void {
  window.open("https://www.npmjs.com/package/@vraxis/distribution-os", "_blank", "noopener,noreferrer");
}

function openSource(): void {
  window.open("https://github.com/Vequan23/distribution-os", "_blank", "noopener,noreferrer");
}
</script>

<template>
  <div class="marketing-site" data-osx-theme="panther">
    <header class="site-nav">
      <a class="brand" href="#top" aria-label="Distribution OS home">
        <span class="brand-mark">D</span>
        <span><strong>Distribution OS</strong><small>Sources → recommendations → results</small></span>
      </a>
      <nav aria-label="Primary navigation">
        <a href="#system">How it works</a>
        <a href="#principles">Why it works</a>
        <a href="#ecosystem">Ecosystem</a>
        <osx-button size="small" icon="terminal" @click="openWorkspace">Get started</osx-button>
      </nav>
    </header>

    <main id="top">
      <section class="hero section-shell" aria-labelledby="hero-title">
        <div class="hero-copy">
          <osx-badge tone="success" dot>OPEN SOURCE · RUNS LOCALLY</osx-badge>
          <p class="eyebrow">DISTRIBUTION FOR TECHNICAL FOUNDERS</p>
          <osx-heading id="hero-title" :level="1" variant="display">Find distribution work worth doing.</osx-heading>
          <osx-copy size="large" tone="muted" measure="wide">
            Distribution OS reads your project sources, real audience signals, and past results. It recommends a few useful actions, drafts the work, and waits for your approval.
          </osx-copy>
          <div class="hero-actions">
            <osx-button variant="primary" icon="play" @click="scrollToId('system')">See how it works</osx-button>
            <osx-button icon="git-branch" @click="openSource">View source</osx-button>
          </div>
          <ul class="trust-line" aria-label="Product principles">
            <li><osx-icon name="lock" :size="15"></osx-icon>Local project data</li>
            <li><osx-icon name="user" :size="15"></osx-icon>You approve public work</li>
            <li><osx-icon name="boxes" :size="15"></osx-icon>Use your model or coding agent</li>
          </ul>
        </div>

        <div class="hero-product" aria-label="Distribution OS product preview">
          <div class="signal-orbit orbit-one"></div>
          <div class="signal-orbit orbit-two"></div>
          <osx-window title="Distribution OS" subtitle="Aperta · Review" :closeable="false" :minimizable="false" :zoomable="false">
            <div class="preview-toolbar">
              <span><osx-icon name="activity" :size="17"></osx-icon>Today’s recommendations</span>
              <osx-badge tone="success" dot>READY</osx-badge>
            </div>
            <div class="preview-body">
              <osx-agent-run-status phase="working" label="Preparing one recommendation" detail="Reading the project brief, accepted signals, and channel rules"></osx-agent-run-status>
              <section class="mobile-run-summary" aria-label="Preparing one contribution, step 2 of 4">
                <header><span>WORK IN PROGRESS</span><b>2 of 4</b></header>
                <strong>Preparing one recommendation</strong>
                <p>Reading project sources and accepted signals.</p>
                <div class="mobile-run-progress" aria-hidden="true"><i></i></div>
              </section>
              <osx-plan title="Sources before action" :steps="loopSteps" :show-progress="true" compact></osx-plan>
              <div class="preview-evidence">
                <span><osx-icon name="file-text" :size="16"></osx-icon><strong>3 cited facts</strong><small>project sources</small></span>
                <span><osx-icon name="inbox" :size="16"></osx-icon><strong>1 accepted signal</strong><small>reviewed by you</small></span>
                <span><osx-icon name="lock" :size="16"></osx-icon><strong>Approval required</strong><small>before publishing</small></span>
              </div>
            </div>
            <osx-status-bar slot="footer" label="Local data ready" status="ready" detail="Nothing published"></osx-status-bar>
          </osx-window>
        </div>
      </section>

      <section class="promise-strip" aria-label="Distribution OS positioning">
        <div><strong>Skip the content treadmill.</strong><span>Make fewer, more useful contributions.</span></div>
        <div><strong>Keep your identity.</strong><span>Review every draft before it reaches a public channel.</span></div>
        <div><strong>Learn from results.</strong><span>Use replies, visits, signups, or revenue in the next plan.</span></div>
      </section>

      <section id="system" class="system-section section-shell">
        <header class="section-heading">
          <div><p class="eyebrow">HOW IT WORKS</p><osx-heading :level="2" variant="title">Start with sources. End with a result.</osx-heading></div>
          <osx-copy tone="muted" measure="default">Each run follows the same four steps. AI can research and draft, but it cannot skip your review or publish on its own.</osx-copy>
        </header>
        <div class="system-grid">
          <article v-for="layer in systemLayers" :key="layer.number">
            <div class="layer-number">{{ layer.number }}</div>
            <span class="layer-icon"><osx-icon :name="layer.icon" :size="22"></osx-icon></span>
            <osx-heading :level="3" variant="section">{{ layer.title }}</osx-heading>
            <osx-copy tone="muted">{{ layer.copy }}</osx-copy>
          </article>
        </div>
      </section>

      <section class="evidence-section section-shell">
        <div class="evidence-copy">
          <p class="eyebrow">WHY YOU CAN CHECK IT</p>
          <osx-heading :level="2" variant="title">AI suggests. You verify.</osx-heading>
          <osx-copy size="large" tone="muted" measure="default">Distribution OS controls the sources, tools, citations, approvals, and results. Your model or coding agent handles the AI work.</osx-copy>
          <div class="boundary-list">
            <div><osx-icon name="check" :size="18"></osx-icon><span><strong>Exact source citations</strong><small>Every recommendation links back to project sources or an accepted audience signal.</small></span></div>
            <div><osx-icon name="check" :size="18"></osx-icon><span><strong>Your choice of AI</strong><small>Use a model API, Claude Code, Cursor, OpenCode, or Codex.</small></span></div>
            <div><osx-icon name="check" :size="18"></osx-icon><span><strong>Approval before publishing</strong><small>You review the exact draft before it reaches a public channel.</small></span></div>
          </div>
        </div>
        <osx-window class="policy-window" title="Automation Rules" subtitle="Always enforced" :closeable="false" :minimizable="false" :zoomable="false">
          <div class="policy-content">
            <osx-alert tone="info" title="Help before you promote">Look for places where your product knowledge can answer a real question.</osx-alert>
            <dl>
              <div><dt>Read connected sources</dt><dd><osx-badge tone="success" dot>AUTOMATIC</osx-badge></dd></div>
              <div><dt>Prepare recommendations</dt><dd><osx-badge tone="success" dot>AUTOMATIC</osx-badge></dd></div>
              <div><dt>Write a new public claim</dt><dd><osx-badge tone="warning" dot>REVIEW</osx-badge></dd></div>
              <div><dt>Publish as you</dt><dd><osx-badge tone="danger" dot>APPROVAL</osx-badge></dd></div>
            </dl>
          </div>
        </osx-window>
      </section>

      <section id="principles" class="principles-section section-shell">
        <header class="section-heading compact-heading">
          <div><p class="eyebrow">WHY IT WORKS</p><osx-heading :level="2" variant="title">Distribution without pretending to be a marketer.</osx-heading></div>
        </header>
        <div class="principle-grid">
          <article><span>01</span><h3>Help before you promote.</h3><p>Find questions your product knowledge can answer before asking anyone to try the product.</p></article>
          <article><span>02</span><h3>Cite before you claim.</h3><p>Use repositories, docs, public pages, and accepted signals to support each recommendation.</p></article>
          <article><span>03</span><h3>Keep the plan small.</h3><p>Review a few useful actions instead of filling an endless content calendar.</p></article>
          <article><span>04</span><h3>Use results next time.</h3><p>Record replies, visits, signups, or revenue. The next plan reads those results.</p></article>
        </div>
      </section>

      <section id="ecosystem" class="ecosystem-section section-shell">
        <header class="ecosystem-heading">
          <div>
            <span class="osx-provenance"><span class="provenance-mark">O</span>Interface built with <strong>OSX Components</strong></span>
            <osx-heading :level="2" variant="title">Tools that keep you in control.</osx-heading>
          </div>
          <osx-copy tone="muted" measure="default">Distribution OS works alongside independent tools for understanding code, building interfaces, and sharing what you learn.</osx-copy>
        </header>
        <div class="ecosystem-grid">
          <osx-ecosystem-card
            v-for="product in ecosystem"
            :key="product.name"
            :name="product.name"
            :category="product.label"
            :description="product.copy"
            :href="product.href"
            :action-label="product.action"
            :mark="product.mark"
            :tone="product.tone"
            :tracking-id="product.trackingId"
          ></osx-ecosystem-card>
        </div>
      </section>

      <section class="closing-section section-shell">
        <div>
          <p class="eyebrow">START WITH ONE PROJECT</p>
          <osx-heading :level="2" variant="display">Find one useful action.</osx-heading>
          <osx-copy size="large" tone="muted" measure="default">Run it locally. Use your model or coding agent. Approve every public draft.</osx-copy>
        </div>
        <div class="closing-actions">
          <osx-button variant="primary" icon="terminal" @click="openWorkspace">Start locally</osx-button>
          <osx-link href="https://github.com/Vequan23/distribution-os" external>Read the source</osx-link>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <span><strong>Distribution OS</strong> · Open-source distribution for technical founders</span>
      <span>Built with <a href="https://osx-components.vercel.app/" target="_blank" rel="noreferrer">OSX Components</a></span>
    </footer>
  </div>
</template>
