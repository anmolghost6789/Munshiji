# Setting up the Munshiji WhatsApp number (Meta)

Munshiji uses one WhatsApp number that businesses' team members forward orders to. Only the company running Munshiji does this setup, once; individual businesses don't.

## 1. Business verification (Meta Business portfolio)
1. Create or open your **Meta Business portfolio** (business.facebook.com) under the legal company name that runs Munshiji.
2. **Security Centre → Start verification.** Use your registered company name, address and phone exactly as on your documents, and a website on your own domain that shows the same name.
3. Upload proof such as the certificate of incorporation, GST registration certificate or Udyam certificate, plus proof of address if asked. Use documents where the name matches the portfolio exactly.
4. Verify by the method offered (email on your domain, phone or SMS). Approval usually takes from a few days to a couple of weeks; Meta may ask for more documents.

## 2. WhatsApp Business Platform (Cloud API)
1. In **Meta for Developers**, create an app of type **Business**, add the **WhatsApp** product, and link it to the verified portfolio.
2. **Add a phone number** that isn't already registered on WhatsApp (or WhatsApp Business app) — a fresh SIM or a landline that can receive a call or SMS for the code.
3. Set the **display name** (for example "Munshiji"). Meta reviews it against your business name and website; follow its display-name guidelines.
4. Note the **phone number ID** (not the phone number itself) → `WHATSAPP_PHONE_NUMBER_ID`, and the app's **app secret** → `WHATSAPP_APP_SECRET`.
5. **Business settings → System users:** create a system user, give it the WhatsApp account with **full control**, and generate a **permanent token** with `whatsapp_business_messaging` and `whatsapp_business_management` → `WHATSAPP_ACCESS_TOKEN`. Don't use the 24-hour test token in production.
6. **Webhook:** URL `https://<your-domain>/api/whatsapp/webhook`, verify token = any random string you also put in `WHATSAPP_VERIFY_TOKEN`. Subscribe to the **messages** field.
7. Set `MUNSHIJI_WHATSAPP_NUMBER` to the number in the form people should see, e.g. `+91 90000 00000`, and redeploy.

## 3. Check it works
1. In Munshiji, **Settings → Your profile → Link number**, and send the `LINK` code from your phone. You should get "Linked ✓".
2. Forward a test order. You should get "Mila ✓", and the draft should appear under **Orders → From WhatsApp**.

## Notes
- Munshiji only replies to people who just messaged it (within WhatsApp's 24-hour window), so it needs no message templates.
- New numbers start with a limit on conversations per day that rises with quality; replies to your own team stay well within it.
- WhatsApp's commerce and business policies apply; don't use the number for marketing.
