# Vox Web Calls deployment

Vox Web Calls uses its own Firebase project, `vox-web-calls`, and its own
ElevenLabs agent. The App Hosting profile opens Google sign-in at `/login`.
Signed-in users can call contacts, create contacts and exchange text messages.
The new project starts with an empty database.

## Firebase setup

1. In `vox-web-calls`, link a Cloud Billing account for App Hosting. Register a
   Firebase web app, enable Google sign-in, and create a Firestore database.
2. Create the `vox-web-calls` App Hosting backend. Use Node.js 22 and associate
   the Firebase web app with the backend. Add the backend's public hostname to
   Authentication's authorized domains.
3. Set the `NEXT_PUBLIC_FIREBASE_*` variables from the registered web app's
   config in App Hosting at build and runtime. These are browser settings.
   Firebase Admin uses the backend's application default credentials.
4. Set `ELEVENLABS_AGENT_ID`, `ELEVENLABS_API_KEY` and `OPENAI_API_KEY` in the
   new project's Secret Manager and grant the backend service account access
   to those secrets. The agent must require signed sessions. This profile uses
   a five-minute call limit, no recording, and zero retention at ElevenLabs.

From a clean checkout of the qualified revision, deploy explicitly to the new
project. The isolated config has an App Hosting backend and Firestore rules.
The existing repository Firebase config serves a different project.

```sh
firebase deploy --project vox-web-calls --config firebase.web-calls.json --only firestore:rules
firebase deploy --project vox-web-calls --config firebase.web-calls.json --only apphosting:vox-web-calls
```

After rollout, confirm the public login and app routes load. A call request
without a Firebase token must return 401. Studio, Telegram webhooks and billing
routes must return 404. Sign in with a verified Google account, select a
contact, and start a call. Check the greeting, a spoken reply, microphone mute
and hang-up. Create a contact and send a text message, then reload to verify
persistence. Check that Firestore denies direct browser reads and writes.

To revert a subsequent rollout, select the last verified rollout in the
App Hosting console. To suspend calls, revoke the backend's dedicated
ElevenLabs key and disable the backend if the app must also go offline.
