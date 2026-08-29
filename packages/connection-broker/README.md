# Connection Broker

Provider-neutral, local-first authorization infrastructure for Vraxis products.

The package owns OAuth Authorization Code + PKCE sessions, loopback callbacks, system-browser launch, opaque credential storage, refresh-token rotation, connection verification, and disconnect lifecycle. It does not own product UI, publishing policy, approval, evidence, or provider actions.

Its public contracts deliberately isolate Node-specific adapters so this directory can be extracted into a standalone Vraxis package without moving Distribution OS domain code.
