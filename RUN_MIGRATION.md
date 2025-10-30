# How to Run the Profile Migration

Since you already exist in the users table but don't have a profile yet, follow these steps:

## Step 1: Open Convex Dashboard

Go to: https://dashboard.convex.dev/d/earnest-ermine-129

## Step 2: Navigate to Functions

1. Click on the **"Functions"** tab in the left sidebar
2. Find the function: `migrations/createMissingProfiles:createMissingProfiles`

## Step 3: Run the Migration

1. Click on the function name
2. The function takes no arguments, so just click **"Run"**
3. You should see output like:
   ```json
   {
     "processedUsers": 1,
     "profilesCreated": 1,
     "alreadyHadProfiles": 0,
     "errors": []
   }
   ```

## Step 4: Verify

After running the migration:

1. Go back to your profile page: http://localhost:3000/profile
2. Your profile should now load!
3. You can now edit and save your profile information

## Alternative: Run via CLI

If you prefer the command line, you can also run:

```bash
npx convex run migrations/createMissingProfiles:createMissingProfiles
```

## What This Does

The migration:

- Finds all users in your database
- Checks if each user has a profile
- Creates a default profile for users without one
- Uses their display name or email username as the default name
- Sets an empty languages array

## After Migration

Once the migration completes, the profile creation will happen automatically for:

- New users during login
- Existing users during their next login (if profile somehow gets deleted)

You only need to run this migration once!
