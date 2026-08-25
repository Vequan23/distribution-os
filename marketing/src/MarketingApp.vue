<script setup lang="ts">
const loopSteps = [
  { id: "truth", title: "Build product memory", detail: "Separate founder intent, public claims, and implementation evidence.", state: "done" },
  { id: "signal", title: "Review a real signal", detail: "Nothing becomes audience evidence until you accept it.", state: "done" },
  { id: "move", title: "Prepare one useful move", detail: "The harness reads evidence, policy, and prior outcomes before drafting.", state: "active" },
  { id: "learn", title: "Record what happened", detail: "Outcomes change the next plan instead of disappearing into analytics.", state: "pending" },
];

const systemLayers = [
  { icon: "book", number: "01", title: "Ground", copy: "Onboard a repository, URL, document, or product brief. Distribution OS cites the product truth it is allowed to use." },
  { icon: "search", number: "02", title: "Sense", copy: "Bring in bounded observations from real places. Every signal stays quarantined until a human reviews it." },
  { icon: "sparkle", number: "03", title: "Decide", copy: "Generate a small ranked queue—not an infinite content calendar. Every move explains why it deserves attention." },
  { icon: "activity", number: "04", title: "Learn", copy: "Approve, skip, execute, and record the result. The next cycle inherits evidence instead of repeating guesses." },
];

const ecosystem = [
  { mark: "A", name: "Aperta", label: "Code comprehension", copy: "Turn AI-generated code into evidence-backed understanding and durable ownership.", href: "https://aperta-six.vercel.app/", action: "Explore Aperta", tone: "info", trackingId: "distribution-site-aperta" },
  { mark: "O", name: "OSX Components", label: "Interface system", copy: "Accessible Vue-authored web components for product interfaces with classic OS X clarity.", href: "https://osx-components.vercel.app/", action: "Browse components", tone: "warning", trackingId: "distribution-site-osx-components" },
  { mark: "V", name: "VQ Clark", label: "Builder notes", copy: "Engineering, architecture, product systems, and the thinking behind this ecosystem.", href: "https://vqclark.vequanclark.chatgpt.site/", action: "Read the journal", tone: "neutral", trackingId: "distribution-site-vqclark" },
];

function scrollToId(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openWorkspace(): void {
  window.open("https://github.com/Vequan23/distribution-os#quick-start", "_blank", "noopener,noreferrer");
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
        <span><strong>Distribution OS</strong><small>Evidence → attention → learning</small></span>
      </a>
      <nav aria-label="Primary navigation">
        <a href="#system">System</a>
        <a href="#principles">Principles</a>
        <a href="#ecosystem">Ecosystem</a>
        <osx-button size="small" icon="terminal" @click="openWorkspace">Get started</osx-button>
      </nav>
    </header>

    <main id="top">
      <section class="hero section-shell" aria-labelledby="hero-title">
        <div class="hero-copy">
          <osx-badge tone="success" dot>LOCAL-FIRST · HUMAN-GOVERNED</osx-badge>
          <p class="eyebrow">THE DISTRIBUTION CONTROL PLANE</p>
          <osx-heading id="hero-title" :level="1" variant="display">Turn product truth into attention that compounds.</osx-heading>
          <osx-copy size="large" tone="muted" measure="wide">
            Distribution OS gives technical founders a repeatable way to find useful conversations, prepare evidence-grounded contributions, and learn what earns trust—without automating their identity.
          </osx-copy>
          <div class="hero-actions">
            <osx-button variant="primary" icon="play" @click="scrollToId('system')">See the operating loop</osx-button>
            <osx-button icon="git-branch" @click="openSource">View source</osx-button>
          </div>
          <ul class="trust-line" aria-label="Product principles">
            <li><osx-icon name="lock" :size="15"></osx-icon>Private product memory</li>
            <li><osx-icon name="user" :size="15"></osx-icon>Human approval</li>
            <li><osx-icon name="boxes" :size="15"></osx-icon>Model agnostic</li>
          </ul>
        </div>

        <div class="hero-product" aria-label="Distribution OS product preview">
          <div class="signal-orbit orbit-one"></div>
          <div class="signal-orbit orbit-two"></div>
          <osx-window title="Distribution OS" subtitle="Evidence loop · Aperta" :closeable="false" :minimizable="false" :zoomable="false">
            <div class="preview-toolbar">
              <span><osx-icon name="activity" :size="17"></osx-icon>Today’s controlled loop</span>
              <osx-badge tone="success" dot>READY</osx-badge>
            </div>
            <div class="preview-body">
              <osx-agent-run-status phase="working" label="Preparing one contribution" detail="Reading product memory, accepted signals, and channel policy"></osx-agent-run-status>
              <osx-plan title="Evidence before action" :steps="loopSteps" :show-progress="true" compact></osx-plan>
              <div class="preview-evidence">
                <span><osx-icon name="file-text" :size="16"></osx-icon><strong>3 cited facts</strong><small>product evidence</small></span>
                <span><osx-icon name="inbox" :size="16"></osx-icon><strong>1 accepted signal</strong><small>human reviewed</small></span>
                <span><osx-icon name="lock" :size="16"></osx-icon><strong>Approval required</strong><small>before identity use</small></span>
              </div>
            </div>
            <osx-status-bar slot="footer" label="Local ledger ready" status="ready" detail="No public action taken"></osx-status-bar>
          </osx-window>
        </div>
      </section>

      <section class="promise-strip" aria-label="Distribution OS positioning">
        <div><strong>Not more content.</strong><span>Fewer, better contributions.</span></div>
        <div><strong>Not autonomous spam.</strong><span>Bounded preparation and explicit approval.</span></div>
        <div><strong>Not vanity analytics.</strong><span>Evidence, decisions, and outcomes in one loop.</span></div>
      </section>

      <section id="system" class="system-section section-shell">
        <header class="section-heading">
          <div><p class="eyebrow">THE SYSTEM</p><osx-heading :level="2" variant="title">Distribution becomes a practice you can inspect.</osx-heading></div>
          <osx-copy tone="muted" measure="default">Every cycle begins with product truth and ends with a recorded outcome. The harness can help with the middle; it cannot quietly skip the human judgment.</osx-copy>
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
          <p class="eyebrow">A DIFFERENT HARNESS</p>
          <osx-heading :level="2" variant="title">The model proposes. The system proves.</osx-heading>
          <osx-copy size="large" tone="muted" measure="default">Distribution OS owns the memory, tools, policy, citations, approvals, and outcomes. Models and agent runtimes supply inference—not authority.</osx-copy>
          <div class="boundary-list">
            <div><osx-icon name="check" :size="18"></osx-icon><span><strong>Exact evidence citations</strong><small>Every recommended move points back to product or audience evidence.</small></span></div>
            <div><osx-icon name="check" :size="18"></osx-icon><span><strong>Portable agent execution</strong><small>Use the native loop or bounded Claude Code, Cursor, OpenCode, and Codex runtimes.</small></span></div>
            <div><osx-icon name="check" :size="18"></osx-icon><span><strong>Hard approval boundaries</strong><small>Public identity and sensitive claims stay with the person responsible for them.</small></span></div>
          </div>
        </div>
        <osx-window class="policy-window" title="Automation Policy" subtitle="Kernel enforced" :closeable="false" :minimizable="false" :zoomable="false">
          <div class="policy-content">
            <osx-alert tone="info" title="Contribution before promotion">The system optimizes for usefulness in places your audience already gathers.</osx-alert>
            <dl>
              <div><dt>Research & preparation</dt><dd><osx-badge tone="success" dot>AUTOMATABLE</osx-badge></dd></div>
              <div><dt>Draft generation</dt><dd><osx-badge tone="success" dot>AUTOMATABLE</osx-badge></dd></div>
              <div><dt>New public claims</dt><dd><osx-badge tone="warning" dot>REVIEW</osx-badge></dd></div>
              <div><dt>Identity-bearing action</dt><dd><osx-badge tone="danger" dot>APPROVAL</osx-badge></dd></div>
            </dl>
          </div>
        </osx-window>
      </section>

      <section id="principles" class="principles-section section-shell">
        <header class="section-heading compact-heading">
          <div><p class="eyebrow">BUILT FOR THE FOUNDER WHO WOULD RATHER BUILD</p><osx-heading :level="2" variant="title">No growth persona required.</osx-heading></div>
        </header>
        <div class="principle-grid">
          <article><span>01</span><h3>Useful beats loud.</h3><p>Find the conversations where your product knowledge can help before asking anyone to care.</p></article>
          <article><span>02</span><h3>Truth before tactics.</h3><p>A source-cited product memory prevents distribution from drifting into generic positioning sludge.</p></article>
          <article><span>03</span><h3>Rhythm beats launch day.</h3><p>A small evidence loop makes distribution durable enough to survive the weeks when attention is quiet.</p></article>
          <article><span>04</span><h3>Outcomes beat impressions.</h3><p>Record what created qualified conversations, activated users, or durable owned assets—and change the next move.</p></article>
        </div>
      </section>

      <section id="ecosystem" class="ecosystem-section section-shell">
        <header class="ecosystem-heading">
          <div>
            <span class="osx-provenance"><span class="provenance-mark">O</span>Interface built with <strong>OSX Components</strong></span>
            <osx-heading :level="2" variant="title">One ecosystem for building with more ownership.</osx-heading>
          </div>
          <osx-copy tone="muted" measure="default">Distribution OS is part of a growing set of independent tools for understanding, shipping, and earning attention—without giving up your judgment.</osx-copy>
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
          <p class="eyebrow">BUILDING IS CHEAP. TRUST IS NOT.</p>
          <osx-heading :level="2" variant="display">Make every distribution move earn its place.</osx-heading>
          <osx-copy size="large" tone="muted" measure="default">Start locally. Bring your own model or agent runtime. Keep the final judgment.</osx-copy>
        </div>
        <div class="closing-actions">
          <osx-button variant="primary" icon="terminal" @click="openWorkspace">Start locally</osx-button>
          <osx-link href="https://github.com/Vequan23/distribution-os" external>Read the source</osx-link>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <span><strong>Distribution OS</strong> · Local-first distribution infrastructure</span>
      <span>Built with <a href="https://osx-components.vercel.app/" target="_blank" rel="noreferrer">OSX Components</a></span>
    </footer>
  </div>
</template>
