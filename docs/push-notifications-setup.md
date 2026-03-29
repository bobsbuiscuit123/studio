# Push Notifications Setup

This repo now contains the app-side code for native iOS push notifications, but delivery still depends on Apple, Firebase, and local iOS dependencies being configured correctly.

## 1. Add Firebase Admin credentials to `.env.local`

Get a Firebase service account JSON from:

- Firebase Console
- Project Settings
- Service accounts
- Generate new private key

Copy these fields into `.env.local`:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Use literal `\n` sequences in `FIREBASE_PRIVATE_KEY`.

## 2. Install CocoaPods dependencies

Run this on your Mac:

```bash
cd /path/to/studio/ios
pod install
```

If `pod` is not installed:

```bash
brew install cocoapods
```

or

```bash
sudo gem install cocoapods
```

## 3. Open the iOS workspace

Open:

```text
ios/App.xcworkspace
```

Do not open `App.xcodeproj` after running `pod install`.

## 4. Enable Apple push capability

In Xcode:

1. Select the `App` target.
2. Open `Signing & Capabilities`.
3. Confirm your Apple Team is selected.
4. Confirm the bundle ID is correct.
5. If `Push Notifications` is missing, click `+ Capability` and add it.

## 5. Enable Push Notifications for the App ID

In Apple Developer:

1. Certificates, Identifiers & Profiles
2. Identifiers
3. Open the app ID for this app
4. Enable `Push Notifications`

## 6. Upload an APNs key to Firebase

In Firebase Console:

1. Project Settings
2. Cloud Messaging
3. iOS app configuration
4. Upload an APNs Authentication Key (`.p8`)
5. Enter the Apple Key ID and Team ID

## 7. Build on a real iPhone

Push notifications do not work in the iOS simulator.

1. Build and run the app on a physical iPhone.
2. Allow notification permissions when prompted.
3. Sign in to the app.

## 8. Test delivery

After the app registers a device token, trigger a push-producing action:

- send a direct message from another account
- send a group message to a chat the device user is in
- create or update an announcement or event that targets another member

## 9. If delivery still fails

Check these in order:

1. Xcode console: look for Firebase or push registration errors.
2. Server logs: look for `Push send failed` or `sendPushToUsers failed`.
3. Supabase `device_push_tokens`: confirm a token row exists for the user and `disabled_at` is null.
4. Firebase Console: confirm the APNs key is uploaded for the same Firebase project as `GoogleService-Info.plist`.
