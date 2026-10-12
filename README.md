# Merchant Desk · GitHub Pages + Supabase

A static, modular, single-page ecommerce management app for a one-person business. It keeps `index.html` as the entry point and can be hosted directly on GitHub Pages without a build step or server-side code.

## Modules

- `index.html` — SPA markup and Google Identity Services loader.
- `styles.css` — app styles and responsive layouts.
- `js/config.js` — public browser configuration placeholders.
- `js/bootstrap.js` — mandatory Google sign-in gate, workspace boot and cloud-sync queue.
- `js/supabase.js` — Supabase Auth client access and workspace metadata persistence only; it contains no Storage upload function.
- `js/drive.js` — Google Drive authorization, photo uploads, and authenticated in-session previews for private Drive files.
- `js/app.js` — Merchant Desk pages and existing catalog, inventory, orders, users, feeds and demo-search UI.
- `supabase/schema.sql` — workspace table and RLS policies; disables legacy image-storage write policies without creating a Storage bucket.

## 1. Create the Supabase project

1. Create a project in [Supabase](https://supabase.com/dashboard).
2. Open **SQL Editor** and run the complete `supabase/schema.sql` script from this repository. If this is an existing project that used the old Storage bucket, the script also removes the former app upload/update/delete policies.
3. In **Project Settings → API**, copy the project URL and the publishable key (the legacy anon key also works with RLS).
4. Open `js/config.js` and replace:
   - `https://YOUR_PROJECT_REF.supabase.co`
   - `YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY`
5. Never put a Supabase `service_role` or secret key in this repository. Anything placed in a static web app can be read by visitors.

### Data model

The current version writes the app's state as a single JSON document per authenticated owner in `public.merchant_desk_state`. This preserves the prototype's existing UI model and is practical for a single-owner workspace. Row Level Security restricts each row to `auth.uid() = user_id`. The JSON document contains products, orders, demo customers, product drafts and saved feeds.

Product image files are saved directly to the seller's Google Drive. Supabase stores only the product metadata, Drive file IDs, Drive view links, and ordinary external image URLs if one was pasted. The app never uploads image blobs or Base64 data to Supabase Storage or saves them in browser local storage. Local files are uploaded to Drive before a product or draft can be saved. URL-based images can remain remote references or be copied to Drive using the image button. Google Drive files are private by default; the app downloads image bytes with the user's in-session Drive authorization to create temporary browser previews. After a page reload, click **Connect Drive** to load private Drive photo previews again.

## 2. Configure compulsory Google sign-in through Supabase

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project and configure **Google Auth Platform / OAuth consent screen**. In **Data Access**, make sure `openid`, `https://www.googleapis.com/auth/userinfo.email`, and `https://www.googleapis.com/auth/userinfo.profile` are enabled for Supabase sign-in.
2. Create an OAuth client with type **Web application**.
3. Under **Authorized JavaScript origins**, add the origin of the GitHub Pages site, e.g. `https://YOUR_GITHUB_USERNAME.github.io`. Add the local development origin you use as well.
4. Under **Authorized redirect URIs**, add the Supabase callback shown in your Supabase project's Google provider setup. Its form is `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`.
5. In Supabase, open **Authentication → Sign In / Providers → Google**, enable Google, and enter the OAuth client ID and client secret from Google Cloud. The client secret belongs only in the Supabase dashboard, never in `js/config.js` or GitHub.
6. In **Authentication → URL Configuration**, set the Site URL and add the exact GitHub Pages app URL as an allowed redirect. For a project site, include the repository path, for example `https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPOSITORY/`. Also add the exact localhost app URL used during development.

Google sign-in is mandatory. There is no unauthenticated local-demo bypass. If this Supabase project is shared with other apps, disable non-Google providers to keep the sign-in policy consistent. Each Google account gets its own workspace. On the first sign-in, the app seeds sample products, demo customer profiles and demo orders into that account so the prototype is immediately testable. These are fabricated demo records, not real customers.

## 3. Google Drive image storage

Drive asks for its own consent, separate from Supabase sign-in. It is required for local image file uploads and for viewing private Drive-backed photos. You can skip it if managing products without images or using only externally hosted image URLs.

1. Enable the **Google Drive API** in the same Google Cloud project.
2. Under Google Auth Platform → **Data Access**, add the `https://www.googleapis.com/auth/drive.file` scope.
3. Use the same Web OAuth client ID in `js/config.js` under `googleClientId` (or use another web client configured with the same allowed JavaScript origins).
4. Add the `https://YOUR_GITHUB_USERNAME.github.io` origin to Authorized JavaScript origins. Add the localhost origin for local testing.
5. If the OAuth consent screen is in Testing mode, add the accounts you want to test with as test users.
6. Sign in to Merchant Desk, click **Connect Drive**, or open a product form and click **Save photos to Drive**. The app requests the `drive.file` scope, creates a `Merchant Desk Product Photos` folder if needed, and uploads selected image files there. Product and draft saves automatically upload new local files to Drive first. The Supabase workspace stores only `drive://FILE_ID` references and basic file metadata, never the bytes.

Drive access tokens exist in memory only and must be re-authorized in a later browser session when needed. Drive file links are stored as metadata in the private Supabase workspace. Drive images remain private unless you change their sharing settings yourself. The in-app product and demo-search previews use authenticated Drive downloads cached as temporary object URLs in browser memory; they are not permanent public image URLs and are not suitable for an unauthenticated public storefront.

## 4. Publish on GitHub Pages

1. Commit this folder's files to a GitHub repository. Keep `index.html` in the repository root.
2. Replace the values in `js/config.js` before publishing.
3. In the repository, open **Settings → Pages** and select the branch and `/ (root)` folder (or configure the desired Pages publishing workflow).
4. Open the resulting Pages URL, test Google sign-in, then create a product and confirm the sync label reaches **Synced**.

All app paths are relative (`./styles.css`, `./js/...`), so repository/project Pages deployments such as `https://username.github.io/repository/` work without rewriting routes. No Node build step is required; the Supabase JS client is imported from the `esm.sh` CDN, so users need an internet connection.

## 5. Local preview

ES modules and OAuth redirects are more reliable when served over HTTP than opened with `file://`. From the repository root, run any static server, for example:

```bash
python -m http.server 8000
```

Then add `http://localhost:8000/` to the Supabase allowed redirect URLs and Google OAuth authorized JavaScript origins, and open that URL in your browser.

## Existing Supabase Storage images

Older versions uploaded photos to the `merchant-product-images` Storage bucket. The new code does not upload to that bucket. For an existing project, you can run `supabase/migrations/20261012_disable_supabase_image_uploads.sql`; it removes the old app write policies without deleting any existing files. To preserve old photos, edit each affected product, click **Save photos to Drive**, and save the product so its stored reference changes to `drive://FILE_ID`. Verify those photos are in Drive before deleting the old bucket or its objects in Supabase Storage. Do not delete the bucket before migrating any photos you still need.

## Security and prototype boundaries

- Only the Supabase publishable/anon key and Google OAuth client ID belong in browser code. Never expose provider client secrets or Supabase service-role keys.
- RLS policies protect the workspace state document. Image bytes never pass through Supabase Storage in the updated app.
- Sync is a debounced whole-state upsert with a browser-local backup. For a single-owner app this is intentionally simple; simultaneous edits from two tabs/devices use last-write-wins behavior. This is not a collaboration system or a normalized multi-tenant ecommerce database.
- The demo order and customer records are generated sample data. Real payment processing, fulfillment, cart checkout, and order ingestion are not implemented.
- Drive scope is limited to app-created/opened files (`drive.file`). The prototype supports saving selected photos to Drive, not importing arbitrary folders from Drive.
- OAuth consent-screen verification may be needed before allowing unrestricted production users, depending on how the Google project is configured.

## Official setup references

- [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase JavaScript OAuth sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithoauth)
- [Google Drive API upload guide](https://developers.google.com/drive/api/guides/manage-uploads)
- [GitHub Pages documentation](https://docs.github.com/en/pages)
