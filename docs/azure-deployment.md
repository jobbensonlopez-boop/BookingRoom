# Deploying to Azure

This guide sets up the first production deployment of Kelmer Room Booking using the **Azure portal** (https://portal.azure.com). No command line is needed: the container image is built by GitHub Actions.

Allow about 1 to 2 hours the first time. Steps 1 to 5 need an Azure subscription; step 6 needs someone who can register applications in Kelmer's Microsoft Entra ID (and grant admin consent).

- [1. How it fits together](#1-how-it-fits-together)
- [2. Before you start](#2-before-you-start)
- [3. Azure resources](#3-azure-resources)
- [4. Environment variables](#4-environment-variables)
- [5. Step-by-step deployment](#5-step-by-step-deployment)
- [6. Checks after the first deployment](#6-checks-after-the-first-deployment)
- [7. Releasing updates and rolling back](#7-releasing-updates-and-rolling-back)
- [8. Troubleshooting](#8-troubleshooting)
- [9. Security notes and later improvements](#9-security-notes-and-later-improvements)

## 1. How it fits together

```
 Employees' browsers ──HTTPS──▶ Azure App Service (Web App for Containers)
        │                         └─ container "room-booking" (port 8080)
        │                              • serves the web app and the /api endpoints
        │                              • applies database migrations at startup
        │                              • validates Microsoft sign-in tokens
        │                                        │ TLS (sslmode=verify-full)
        │                                        ▼
        │                         Azure Database for PostgreSQL (Flexible Server)
        │                              • database "booking"
        │
        └──sign-in──▶ Microsoft Entra ID (Kelmer tenant)

 GitHub Actions ──"Publish image to Azure" (run by hand)──▶ Azure Container Registry
                                                              └─ room-booking:latest  ──▶ pulled by App Service
```

The app is a single container. Its settings are all environment variables, set as **App Settings** on the Web App. The same image can be used for a test and a production environment.

## 2. Before you start

You need:

- **Azure:** a subscription where you have the *Contributor* (or *Owner*) role.
- **Microsoft Entra ID:** someone with the *Application Administrator* (or *Cloud Application Administrator*) role in Kelmer's tenant, to create the two app registrations and grant admin consent.
- **GitHub:** admin access to the `BookingRoom` repository, to add three secrets and run a workflow.

Decide these before you begin:

| Decision | Suggested value | Notes |
| --- | --- | --- |
| Azure region | The region closest to the office (for example **UAE North** for Dubai) | Put every resource in the same region. |
| Office timezone | `Asia/Dubai` | IANA name. All booking times use it. **Confirm it with Kelmer.** |
| Resource names | See the table in [section 3](#3-azure-resources) | Some names must be globally unique; add a suffix if a name is taken. |

Keep a scratch note (in a password manager, not a shared document) to collect the values you'll copy along the way: the database password, registry credentials, and client IDs.

## 3. Azure resources

| # | Resource | Suggested name | Size to start with | Purpose |
| --- | --- | --- | --- | --- |
| 1 | Resource group | `rg-room-booking` | n/a | Holds everything below. |
| 2 | Azure Database for PostgreSQL – **Flexible Server** | `psql-kelmer-booking` (globally unique) | PostgreSQL **16**, *Burstable* **B1ms**, 32 GiB storage, high availability off | Stores bookings. |
| 3 | Container Registry | `acrkelmerbooking` (globally unique, letters and digits only) | **Basic** | Stores the app's container image. |
| 4 | App Service plan | `asp-room-booking` | **Linux**, **Basic B1** | The compute the Web App runs on. |
| 5 | Web App (container) | `app-kelmer-room-booking` (globally unique) | 1 instance | Runs the app. |
| 6 | Entra ID app registration | `Room Booking API` | n/a | Represents the API; access tokens are issued for it. |
| 7 | Entra ID app registration | `Room Booking` | n/a | Represents the web app that users sign in to. |

These sizes are ample for one meeting room and a company-sized team, and each can be scaled up later without redeploying. For current prices, use the Azure pricing calculator.

## 4. Environment variables

Set these as **App Settings** on the Web App (step 5.7). Values in `<…>` are collected during the steps.

### Required

| Name | Example | Where the value comes from |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://bookingadmin:<password>@psql-kelmer-booking.postgres.database.azure.com:5432/booking?sslmode=verify-full` | Step 5.2. Keep `?sslmode=verify-full`, which encrypts the connection and verifies the server's certificate. If the password contains characters other than letters and digits, they must be URL-encoded (for example `@` → `%40`); the simplest option is a long password of only letters and digits. |
| `OFFICE_TIMEZONE` | `Asia/Dubai` | Your decision in section 2. |
| `ENTRA_TENANT_ID` | `xxxxxxxx-xxxx-…` | Step 5.6: *Directory (tenant) ID*. |
| `ENTRA_API_CLIENT_ID` | `xxxxxxxx-xxxx-…` | Step 5.6: *Application (client) ID* of **Room Booking API**. |
| `ENTRA_SPA_CLIENT_ID` | `xxxxxxxx-xxxx-…` | Step 5.6: *Application (client) ID* of **Room Booking**. |
| `WEBSITES_PORT` | `8080` | Fixed. Tells App Service which port the container listens on. |

### Optional

| Name | Default | Notes |
| --- | --- | --- |
| `ROOM_NAME` | `Boardroom` | Shown in the heading. |
| `ROOM_CAPACITY` | `8` | Maximum attendees. The database also enforces 8; changing this needs a code change too. |
| `ENTRA_REQUIRED_SCOPE` | `access_as_user` | Only change it if you named the API scope differently in step 5.6. |
| `ENTRA_API_SCOPE` | `api://<ENTRA_API_CLIENT_ID>/access_as_user` | Only needed if the API's Application ID URI is not the default. |

### Already set inside the image (do not add)

| Name | Value in image | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `production` | Production mode. Also blocks the development sign-in bypass. |
| `PORT` | `8080` | Port the app listens on. |
| `RUN_MIGRATIONS` | `true` | Create and update database tables at startup. It's safe with several instances because a database lock ensures only one runs them. |
| `STATIC_DIR` | `/app/web/dist` | The built web app. |
| `AUTH_MODE` | `entra` (default) | **Never set this to `dev` in Azure.** The app refuses to start if you do. |

### GitHub repository secrets (for publishing the image)

| Secret | Value |
| --- | --- |
| `ACR_LOGIN_SERVER` | Registry *Login server*, for example `acrkelmerbooking.azurecr.io` (step 5.3) |
| `ACR_USERNAME` | Registry admin *Username* (step 5.3) |
| `ACR_PASSWORD` | Registry admin *password* (step 5.3) |

## 5. Step-by-step deployment

Portal menus change from time to time. If a label differs slightly, use the search box at the top of the portal or the search box inside a resource's left-hand menu.

### 5.1 Create the resource group

1. In the portal, search for **Resource groups** and select **+ Create**.
2. Choose your **Subscription**, enter **Resource group** `rg-room-booking`, and pick your **Region**.
3. Select **Review + create**, then **Create**.

### 5.2 Create the PostgreSQL database

1. Search for **Azure Database for PostgreSQL flexible servers** and select **+ Create**. If asked, choose **Flexible server**.
2. On **Basics**:
   - **Resource group:** `rg-room-booking`
   - **Server name:** `psql-kelmer-booking`
   - **Region:** the same region as the resource group
   - **PostgreSQL version:** **16**
   - **Workload type:** *Development*. Then select **Configure server** and choose **Burstable**, **Standard_B1ms**, **32 GiB** storage, and select **Save**.
   - **High availability:** off (you can enable it later).
   - **Authentication method:** *PostgreSQL authentication only*
   - **Admin username:** `bookingadmin`
   - **Password:** a long password made of letters and digits. Save it in your note.
3. On **Networking**:
   - **Connectivity method:** *Public access (allowed IP addresses)*
   - Tick **Allow public access from any Azure service within Azure to this server**. This lets the Web App connect. See [section 9](#9-security-notes-and-later-improvements) for the stricter option.
   - Don't add other IP addresses unless someone needs to connect from their own computer.
4. Select **Review + create**, then **Create**. This takes about 5 to 10 minutes.
5. When it finishes, open the server and **allow the extension the app needs**. Without this, the app can't enforce "no overlapping bookings" and fails to start.
   - In the left menu choose **Settings → Server parameters**.
   - Search for `azure.extensions`.
   - In its value list, tick **BTREE_GIST**.
   - Select **Save**. The setting applies without a restart.
6. Create the database:
   - In the left menu choose **Settings → Databases**, then select **+ Add**.
   - **Name:** `booking`, then select **Save**.
7. On **Overview**, copy the **Server name** (for example `psql-kelmer-booking.postgres.database.azure.com`). Write your `DATABASE_URL` in your note:
   ```
   postgres://bookingadmin:<password>@<server name>:5432/booking?sslmode=verify-full
   ```

You don't need to create any tables. The app creates them the first time it starts.

### 5.3 Create the container registry

1. Search for **Container registries** and select **+ Create**.
2. **Resource group:** `rg-room-booking`. **Registry name:** `acrkelmerbooking`. **Location:** your region. **Pricing plan:** *Basic*.
3. Select **Review + create**, then **Create**.
4. Open the registry. In the left menu choose **Settings → Access keys**:
   - Turn **Admin user** on.
   - Copy **Login server**, **Username** and **password** (either password works) into your note.

### 5.4 Publish the first image from GitHub

1. On GitHub, open the repository, then go to **Settings → Secrets and variables → Actions → New repository secret**. Add the three secrets:
   - `ACR_LOGIN_SERVER`: the Login server (for example `acrkelmerbooking.azurecr.io`)
   - `ACR_USERNAME`: the Username
   - `ACR_PASSWORD`: the password
2. Go to the **Actions** tab, choose **Publish image to Azure** in the left list, then **Run workflow** with branch **main**, and select **Run workflow** again.
3. Wait for a green tick (about 2 to 4 minutes). The run summary shows `Pushed …/room-booking:latest and :<commit>`.
4. Optional check: in the registry, open **Services → Repositories**. You should see `room-booking` with tags `latest` and a 7-character commit ID.

### 5.5 Create the Web App

1. Search for **App Services**, then select **+ Create → Web App**.
2. On **Basics**:
   - **Resource group:** `rg-room-booking`
   - **Name:** `app-kelmer-room-booking`
   - **Publish:** **Container**
   - **Operating System:** **Linux**
   - **Region:** your region
   - **Linux Plan:** **Create new**, named `asp-room-booking`
   - **Pricing plan:** **Basic B1** (choose *Explore pricing plans* if B1 isn't listed)
   - Leave other options at their defaults.
3. On **Container** (called *Docker* in some portal versions):
   - **Image source:** *Azure Container Registry*
   - **Registry:** `acrkelmerbooking`
   - **Authentication:** *Admin credentials*
   - **Image:** `room-booking`
   - **Tag:** `latest`
   - **Port** (if shown): `8080`
   - **Startup command:** leave empty.
4. Select **Review + create**, then **Create**.
5. Open the Web App. On **Overview**, copy the **Default domain** (for example `app-kelmer-room-booking-xxxxxxxx.uaenorth-01.azurewebsites.net`). Your app's address is `https://<default domain>`. You need it in the next step.

The app won't work yet, because it has no settings. That's expected until step 5.7.

### 5.6 Register the app in Microsoft Entra ID

Do this in the portal under **Microsoft Entra ID → App registrations**, or in the Entra admin center (https://entra.microsoft.com).

**A. The API registration**

1. Select **+ New registration**.
   - **Name:** `Room Booking API`
   - **Supported account types:** *Accounts in this organizational directory only (single tenant)*
   - **Redirect URI:** leave empty.
   - Select **Register**.
2. On **Overview**, copy the **Application (client) ID** (this is `ENTRA_API_CLIENT_ID`) and the **Directory (tenant) ID** (this is `ENTRA_TENANT_ID`).
3. Choose **Expose an API**:
   - Next to **Application ID URI**, select **Add** and accept the suggested `api://<client id>`, then select **Save**.
   - Select **+ Add a scope**: **Scope name** `access_as_user`; **Who can consent** *Admins and users*; **Admin consent display name** `Use Room Booking`; **Admin consent description** `Allows the app to book the meeting room on behalf of the signed-in user.`; **State** *Enabled*. Then select **Add scope**.
4. Recommended: choose **Manifest** and set the access token version to **2**. In the current manifest format this is `"requestedAccessTokenVersion": 2` inside the `"api"` section; in the older format it is `"accessTokenAcceptedVersion": 2`. Select **Save**. The app accepts either version, but version 2 is the modern default.

**B. The web app (SPA) registration**

1. Select **+ New registration**.
   - **Name:** `Room Booking`
   - **Supported account types:** *Accounts in this organizational directory only (single tenant)*
   - **Redirect URI:** platform **Single-page application (SPA)**, value `https://<default domain from step 5.5>`. Use no trailing slash.
   - Select **Register**.
2. On **Overview**, copy the **Application (client) ID**. This is `ENTRA_SPA_CLIENT_ID`.
3. Choose **API permissions**:
   - Select **+ Add a permission**, then **APIs my organization uses** (or **My APIs**), then **Room Booking API**.
   - Choose **Delegated permissions**, tick **access_as_user**, and select **Add permissions**.
   - Select **Grant admin consent for <your organisation>** and confirm. The status column should show green ticks.
4. Optional, to let only certain people use the app: open **Enterprise applications → Room Booking → Properties**, set **Assignment required?** to **Yes**, and select **Save**. Then add people or groups under **Users and groups**.

### 5.7 Configure the Web App

1. Open the Web App and go to **Settings → Environment variables** (in older portals, **Configuration → Application settings**).
2. On **App settings**, select **+ Add** for each **required** variable in [section 4](#required):
   `DATABASE_URL`, `OFFICE_TIMEZONE`, `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_SPA_CLIENT_ID`, `WEBSITES_PORT` = `8080`.
   Add optional ones only if you need them. Leave **Deployment slot setting** unticked.
3. Select **Apply** (or **Save**), then **Confirm**. The app restarts.
4. Go to **Settings → Configuration → General settings**:
   - **HTTPS Only:** On
   - **Always on:** On (avoids a slow first request after idle periods)
   - **Minimum TLS version:** 1.2
   - Select **Save**.
5. Go to **Monitoring → Health check**: enable it, set **Path** to `/api/health`, and select **Save**.
6. Go to **Deployment → Deployment Center**:
   - Check that **Registry**, **Image** and **Tag** read `acrkelmerbooking`, `room-booking` and `latest`.
   - Set **Continuous deployment** to **On** and select **Save**. From now on, each publish from GitHub (step 5.4) redeploys the app automatically.

### 5.8 First start

1. On **Overview**, select **Restart** and confirm.
2. Open **Monitoring → Log stream**. Within a minute or two you should see:
   ```
   applied 001_bookings.sql
   Room booking API listening on :8080 (auth: entra, tz: Asia/Dubai)
   ```
   `applied 001_bookings.sql` appears only on the very first start. Later starts show just the "listening" line.
3. Continue with the checks below.

## 6. Checks after the first deployment

| # | Check | Expected result |
| --- | --- | --- |
| 1 | Open `https://<default domain>/api/health` | `{"ok":true}` |
| 2 | Open `https://<default domain>/api/client-config` | `authMode` is `entra`, with your tenant ID, the **SPA** client ID, and `api://<API client id>/access_as_user` |
| 3 | Open `https://<default domain>/` | You're sent to the Microsoft sign-in page, then back to the app with your initials in the top-right corner |
| 4 | Create a booking | A "Booked …" toast appears and the booking shows in the day's schedule |
| 5 | Try an overlapping time | A red "Overlaps with …" message appears and **Book room** is disabled |
| 6 | **My bookings** | Lists your upcoming booking |
| 7 | Cancel it | A confirmation dialog appears, then the booking disappears |
| 8 | A colleague signs in on their own computer | They see your bookings with your name, but no Cancel button on them |
| 9 | Open the app in a private window without signing in, and call `/api/me` | `401 Sign in required.` |

Once all nine pass, the deployment is complete. Share `https://<default domain>` with staff. A custom domain such as `rooms.kelmer.com` is optional; it can be added later under **Settings → Custom domains**. Add its URL as an extra SPA redirect URI in step 5.6 B.

## 7. Releasing updates and rolling back

**Release:** merge the change into `main`, wait for CI to pass, then run **Actions → Publish image to Azure → Run workflow**. With continuous deployment on, the Web App pulls the new `latest` image and restarts within a few minutes. Any new database migrations apply automatically on start.

**Roll back:** every publish also tags the image with its 7-character commit ID. In **Deployment Center**, change **Tag** from `latest` to the previous commit's ID, select **Save**, and restart. Switch back to `latest` once the fix is published. Database migrations aren't reversed automatically; so far there is only one.

**Backups:** the PostgreSQL server keeps automatic backups (7 days by default). You can change the retention or restore to a point in time under the server's **Backup and restore**.

## 8. Troubleshooting

Start with **Web App → Monitoring → Log stream**. The app prints a clear error before exiting.

| Symptom (log stream or browser) | Cause and fix |
| --- | --- |
| `Missing required environment variable X` | Add `X` under **Environment variables** (step 5.7) and restart. |
| `OFFICE_TIMEZONE "…" is not a valid IANA timezone` | Use a name such as `Asia/Dubai` or `Europe/London`. |
| `AUTH_MODE=dev is not allowed when NODE_ENV=production` | Remove the `AUTH_MODE` setting (or set it to `entra`). |
| `extension "btree_gist" is not allow-listed …` | Do step 5.2 (5): allow **BTREE_GIST** in `azure.extensions`, then restart the Web App. |
| `password authentication failed for user …` | Check the username and password in `DATABASE_URL`. URL-encode special characters, or use a letters-and-digits password. |
| `database "booking" does not exist` | Do step 5.2 (6). |
| Connection timeout or `ETIMEDOUT` to `…postgres.database.azure.com` | On the database's **Networking** page, tick *Allow public access from any Azure service within Azure to this server* and select **Save**. |
| `self-signed certificate` or other certificate errors | Use the full server name ending `.postgres.database.azure.com` in `DATABASE_URL`, not an IP address. |
| *Application Error* page, or the container keeps restarting with no app log | Check `WEBSITES_PORT` = `8080`, and that Deployment Center shows the right registry, image and tag. |
| Microsoft sign-in shows **AADSTS50011** (redirect URI mismatch) | The SPA registration's redirect URI must be exactly `https://<default domain>`, of type *Single-page application*. |
| Sign-in shows **AADSTS65001** or asks for consent | Do step 5.6 B (3): **Grant admin consent**. |
| After sign-in, the app shows "This account cannot use room booking." | The token is from another tenant, or lacks `access_as_user`. Check `ENTRA_TENANT_ID`, the API permission, and admin consent. |
| After sign-in, the app shows "Your session has expired. Sign in again." on every load | Check that `ENTRA_API_CLIENT_ID` is the **API** registration's ID (not the SPA's) and that its Application ID URI is `api://<that id>`. |
| The GitHub workflow fails at "Check repository secrets" | Add the three `ACR_…` secrets (step 5.4). |
| The GitHub workflow fails at "Log in" | The registry **Admin user** must be on; copy the username and password again. |

## 9. Security notes and later improvements

This setup is secure for an internal app. All traffic is HTTPS and every API call needs a valid Microsoft sign-in from your tenant. The database connection is encrypted with a verified certificate, and the container runs as a non-root user. These upgrades can come later:

- **Private database networking:** "Allow public access from any Azure service" lets any service running in Azure *attempt* to connect (a password is still required). For a stricter setup, put the Web App and database in a virtual network, using Web App **VNet integration** and a database with **private access**, and turn public access off.
- **Secrets in Key Vault:** store `DATABASE_URL` in Azure Key Vault and reference it from the App Setting (`@Microsoft.KeyVault(...)`), instead of pasting the password into App Settings. App Settings are encrypted at rest, but Key Vault adds access auditing and rotation.
- **Managed identity for the registry:** replace the registry admin user with the Web App's managed identity (*AcrPull* role), and use OpenID Connect from GitHub to Azure instead of the `ACR_PASSWORD` secret.
- **Staging slot:** the Standard plan adds deployment slots, so a new version can be checked before swapping it into production.
- **Monitoring:** enable Application Insights on the Web App for request and error tracking.

Not included in this deployment: Outlook calendar invites (planned separately).
