import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// The real, working LyneSign logo — public/logo.png is already served
// statically at the app's own domain root, so this resolves to a genuine,
// reachable image URL (not a "fill this in" placeholder) for every branded
// HTML starter template below. Computed from NEXTAUTH_URL at seed time, same
// pattern as the Stripe price env vars just below, so re-seeding in a real
// production environment automatically bakes in the right domain.
const LOGO_URL = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/logo.png`;

// Same pattern as LOGO_URL — real, reachable icon assets (public/social/*.png,
// simple white glyphs meant to sit on the templates' own tan circular badge)
// rather than hotlinking a third party's marketing-site CDN, which is neither
// guaranteed to stay available nor reliably fetched by every mail client.
const APP_BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const SOCIAL_ICON_URLS = {
  facebook: `${APP_BASE_URL}/social/facebook.png`,
  linkedin: `${APP_BASE_URL}/social/linkedin.png`,
  instagram: `${APP_BASE_URL}/social/instagram.png`,
  youtube: `${APP_BASE_URL}/social/youtube.png`,
};

// stripePriceId is left null for any tier whose env var isn't set yet —
// getEffectiveSubscription/checkout still work, checkout just can't be
// completed for that tier until you create the Product/Price in Stripe and
// set the env var (see .env.example).
const PLANS = [
  {
    key: "free",
    name: "Free",
    monthlyPriceCents: 0,
    stripePriceId: null,
    contactLimit: 100,
    emailsPerMonthLimit: 200,
    activeSequenceLimit: 1,
    templateLimit: 5,
    crmEnabled: false,
    aiGenerationsPerMonthLimit: 20,
    socialAccountLimit: 0,
  },
  {
    key: "starter",
    name: "Starter",
    monthlyPriceCents: 3900,
    stripePriceId: process.env.STRIPE_PRICE_STARTER ?? null,
    contactLimit: 1000,
    emailsPerMonthLimit: 2000,
    activeSequenceLimit: 3,
    templateLimit: 20,
    crmEnabled: false,
    aiGenerationsPerMonthLimit: 300,
    socialAccountLimit: 1,
  },
  {
    key: "pro",
    name: "Pro",
    monthlyPriceCents: 9900,
    stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
    contactLimit: 10000,
    emailsPerMonthLimit: 20000,
    activeSequenceLimit: -1,
    templateLimit: -1,
    crmEnabled: true,
    aiGenerationsPerMonthLimit: -1,
    socialAccountLimit: 5,
  },
  {
    key: "agency",
    name: "Agency",
    monthlyPriceCents: 24900,
    stripePriceId: process.env.STRIPE_PRICE_AGENCY ?? null,
    contactLimit: 50000,
    emailsPerMonthLimit: 100000,
    activeSequenceLimit: -1,
    templateLimit: -1,
    crmEnabled: true,
    aiGenerationsPerMonthLimit: -1,
    socialAccountLimit: -1,
  },
];

// Fixed, platform-wide taxonomy — see the Template Library upgrade plan for
// why this is data (editable later with no code change) rather than a Prisma
// enum, and why lower-relevance categories (eCards, Invites, Legal, Real
// Estate, Job Seeker, Holiday/Seasonal) were deliberately left out of v1.
const TEMPLATE_CATEGORIES = [
  { key: "cold_emails", label: "Cold Emails", sortOrder: 1 },
  { key: "newsletters", label: "Newsletters", sortOrder: 2 },
  { key: "marketing_promotions", label: "Marketing / Promotions", sortOrder: 3 },
  { key: "onboarding_welcome", label: "Onboarding / Welcome", sortOrder: 4 },
  { key: "reengagement_winback", label: "Re-engagement / Win-back", sortOrder: 5 },
  { key: "appointment_reminders", label: "Appointment Reminders", sortOrder: 6 },
  { key: "thank_you_receipts", label: "Thank You / Receipts", sortOrder: 7 },
  { key: "business_general", label: "Business / General", sortOrder: 8 },
];

// Merge vars use the app's real {{snake_case}} syntax (src/lib/personalization/mergeVars.ts).
// Bracketed [Placeholders] are NOT merge vars — they're plain text the customer
// is expected to edit by hand before sending (product name, dates, offer specifics),
// since this app has no concept of a "sender business name" merge field — the
// account's own signature is appended automatically at send time.
const STARTER_TEMPLATES = [
  // --- Cold Emails ---
  {
    key: "cold_quick_intro",
    categoryKey: "cold_emails",
    sortOrder: 1,
    name: "Quick Intro — Cold Outreach",
    subject: "Quick question, {{first_name}}",
    body: `<p>Hi {{first_name}},</p><p>I'll keep this short — I came across {{company}} and thought there might be a fit with what we do.</p><p>We help teams like yours [one-line value proposition]. Worth a quick 15-minute call to see if it's relevant?</p><p>If not, no worries at all — just reply and let me know.</p>`,
  },
  {
    key: "cold_value_prop_30s",
    categoryKey: "cold_emails",
    sortOrder: 2,
    name: "Value Prop in 30 Seconds",
    subject: "A faster way to [outcome] at {{company}}",
    body: `<p>Hi {{first_name}},</p><p>Most teams at companies like {{company}} spend too much time on [problem]. We built [product/service] to fix exactly that — [specific outcome, e.g. "cut that time in half"].</p><p>Happy to show you in under 10 minutes. Does this week work?</p>`,
  },
  {
    key: "cold_referral_style",
    categoryKey: "cold_emails",
    sortOrder: 3,
    name: "Referral-Style Cold Email",
    subject: "{{first_name}}, thought this might help {{company}}",
    body: `<p>Hi {{first_name}},</p><p>I've been working with a few companies in [industry/space] and {{company}} came to mind.</p><p>We've helped similar teams [specific result]. Thought it might be worth a conversation — open to a quick call?</p><p>Either way, wishing you continued success at {{company}}.</p>`,
  },
  {
    key: "cold_pain_point_opener",
    categoryKey: "cold_emails",
    sortOrder: 4,
    name: "Pain Point Cold Opener",
    subject: "Still dealing with [pain point]?",
    body: `<p>Hi {{first_name}},</p><p>If [specific pain point] is still eating up time at {{company}}, you're not alone — it's the #1 thing we hear from teams before they start working with us.</p><p>We built [product/service] specifically to solve it. Want to see how it works in a quick 15-minute call?</p>`,
  },

  // --- Newsletters ---
  {
    key: "newsletter_monthly_update",
    categoryKey: "newsletters",
    sortOrder: 1,
    name: "Monthly Company Update",
    subject: "Here's what's new this month",
    body: `<p>Hi {{first_name}},</p><p>Here's a quick roundup of what's happened over the past month:</p><ul><li>[Update or milestone #1]</li><li>[Update or milestone #2]</li><li>[Update or milestone #3]</li></ul><p>Thanks for being part of this — more updates coming next month.</p>`,
  },
  {
    key: "newsletter_weekly_roundup",
    categoryKey: "newsletters",
    sortOrder: 2,
    name: "Weekly Roundup",
    subject: "Your weekly roundup is here",
    body: `<p>Hi {{first_name}},</p><p>Here's what's worth knowing this week:</p><ul><li>[Story or link #1]</li><li>[Story or link #2]</li><li>[Story or link #3]</li></ul><p>See you next week!</p>`,
  },
  {
    key: "newsletter_product_tips",
    categoryKey: "newsletters",
    sortOrder: 3,
    name: "Product Tips Digest",
    subject: "3 tips to get more out of [Product]",
    body: `<p>Hi {{first_name}},</p><p>A few quick tips to help you get more value out of [Product]:</p><ol><li>[Tip #1]</li><li>[Tip #2]</li><li>[Tip #3]</li></ol><p>Questions about any of these? Just reply — happy to help.</p>`,
  },
  {
    key: "newsletter_industry_digest",
    categoryKey: "newsletters",
    sortOrder: 4,
    name: "Industry News Digest",
    subject: "This week in [Industry]",
    body: `<p>Hi {{first_name}},</p><p>Here's what's happening in [Industry] this week:</p><ul><li>[Headline or trend #1]</li><li>[Headline or trend #2]</li><li>[Headline or trend #3]</li></ul><p>Thoughts on any of these? Reply and let me know.</p>`,
  },

  // --- Marketing / Promotions ---
  {
    key: "promo_limited_time_discount",
    categoryKey: "marketing_promotions",
    sortOrder: 1,
    name: "Limited-Time Discount",
    subject: "{{first_name}}, save 20% this week only",
    body: `<p>Hi {{first_name}},</p><p>For a limited time, get <strong>20% off</strong> [product/service] — this offer ends [date].</p><p><a href="[link]">Claim your discount</a></p><p>Use code <strong>[CODE]</strong> at checkout.</p>`,
  },
  {
    key: "promo_new_product_launch",
    categoryKey: "marketing_promotions",
    sortOrder: 2,
    name: "New Product Launch",
    subject: "Introducing our newest [Product]",
    body: `<p>Hi {{first_name}},</p><p>We're excited to introduce [Product Name] — built to help you [key benefit].</p><p>Here's what's new:</p><ul><li>[Feature #1]</li><li>[Feature #2]</li><li>[Feature #3]</li></ul><p><a href="[link]">See it in action</a></p>`,
  },
  {
    key: "promo_flash_sale",
    categoryKey: "marketing_promotions",
    sortOrder: 3,
    name: "Flash Sale Announcement",
    subject: "24 hours only: flash sale inside",
    body: `<p>Hi {{first_name}},</p><p>Our flash sale is live for the next 24 hours only — [discount/offer details].</p><p><a href="[link]">Shop the sale</a></p><p>Don't wait — this one disappears at [time/date].</p>`,
  },
  {
    key: "promo_seasonal",
    categoryKey: "marketing_promotions",
    sortOrder: 4,
    name: "Seasonal Promotion",
    subject: "Our [Season] sale starts now",
    body: `<p>Hi {{first_name}},</p><p>Our [Season] sale is here — [offer details] on [product/category].</p><p><a href="[link]">Browse the sale</a></p><p>Offer valid through [end date].</p>`,
  },
  {
    // A second, more elaborate HTML-format example — generated through the
    // actual visual-editor pipeline (real MJML source compiled server-side
    // by PATCH /api/templates/[id], not hand-typed table HTML like the
    // LyneSign announcement above), demonstrating native MJML components
    // (mj-image, mj-social, mj-text) and the Part 1 8-section layout.
    key: "promo_product_launch_html",
    categoryKey: "marketing_promotions",
    sortOrder: 5,
    name: "Product Launch — Branded Template",
    subject: "Introducing Geofencing",
    bodyFormat: "HTML" as const,
    body: `<!doctype html>
<html lang="und" dir="auto" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <title></title>
    <!--[if !mso]><!-->
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <!--<![endif]-->
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style type="text/css">
      #outlook a { padding:0; }
      body { margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
      table, td { border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt; }
      img { border:0;height:auto;line-height:100%; outline:none;text-decoration:none;-ms-interpolation-mode:bicubic; }
      p { display:block;margin:13px 0; }
    </style>
    <!--[if mso]>
    <noscript>
    <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
    </xml>
    </noscript>
    <![endif]-->
    <!--[if lte mso 11]>
    <style type="text/css">
      .mj-outlook-group-fix { width:100% !important; }
    </style>
    <![endif]-->
    
      <!--[if !mso]><!-->
        <link href="https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700" rel="stylesheet" type="text/css">
        <style type="text/css">
          @import url(https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700);
        </style>
      <!--<![endif]-->

    
    
    <style type="text/css">
      @media only screen and (min-width:480px) {
        .mj-column-per-100 { width:100% !important; max-width: 100%; }
      }
    </style>
    <style media="screen and (min-width:480px)">
      .moz-text-html .mj-column-per-100 { width:100% !important; max-width: 100%; }
    </style>
    
    
  
    
    <style type="text/css">

    @media only screen and (max-width:479px) {
      table.mj-full-width-mobile { width: 100% !important; }
      td.mj-full-width-mobile { width: auto !important; }
    }
  
    </style>
    
    
  </head>
  
      <body  style="word-spacing:normal;background-color:#F4F4F4;">
        
        <div
           aria-roledescription="email" role="article" lang="und" dir="auto" style="word-spacing:normal;background-color:#F4F4F4;"
        >
        
      
      <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px 24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;"
      >
        <tbody>
          <tr>
            <td  style="width:160px;">
              
      <img
         alt="LyneSign" src="${LOGO_URL}" style="border:0;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;" width="160" height="auto"
      />
    
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;line-height:1;text-align:center;text-transform:uppercase;color:#DDA974;"
      >New From LyneSign</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:28px;font-weight:700;line-height:1.25;text-align:center;color:#FFFFFF;"
      >Introducing Geofencing</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:center;color:#C7CDD9;"
      >Reach customers the moment they're near your business — no billboard required.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;"
      >
        <tbody>
          <tr>
            <td
               align="center" bgcolor="#DDA974" role="presentation" style="border:none;border-radius:10px;cursor:auto;mso-padding-alt:10px 25px;background:#DDA974;" valign="middle"
            >
              <a
                 href="https://lynesign.com/landing/#final-cta" style="display:inline-block;background:#DDA974;color:#FFFFFF;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;font-weight:700;line-height:120%;letter-spacing:0.5px;margin:0;text-decoration:none;text-transform:uppercase;padding:10px 25px;mso-padding-alt:0px;border-radius:10px;" target="_blank"
              >
                Get Started
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:40px 40px 8px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Hi {{first_name}},</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >We're rolling out a new way to put LyneSign to work for you: Geofencing. It draws a virtual perimeter around your business and sends targeted mobile ads to shoppers the moment they step inside it — turning foot traffic already headed your way into customers who walk through your door.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1;text-align:left;color:#666666;"
      >Need help? <a href="https://lynesign.com/contact-us/#" style="color:#DDA974;font-weight:700;text-decoration:none;">Contact support</a></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:8px 40px 40px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;"
      >
        <tbody>
          <tr>
            <td  style="width:520px;">
              
      <img
         alt="A person using geofencing on their phone to navigate to a nearby business" src="https://lynesign.com/wp-content/uploads/2024/07/Geofencing-Display-Advertising.webp" style="border:0;border-radius:12px;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;" width="520" height="auto"
      />
    
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 4px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;line-height:1;text-align:center;text-transform:uppercase;color:#DDA974;"
      >Available Now</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:20px;font-weight:700;line-height:1;text-align:center;color:#FFFFFF;"
      >Ask us about geofencing for your business</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;"
      >
        <tbody>
          <tr>
            <td
               align="center" bgcolor="#DDA974" role="presentation" style="border:none;border-radius:10px;cursor:auto;mso-padding-alt:10px 25px;background:#DDA974;" valign="middle"
            >
              <a
                 href="https://lynesign.com/landing/#final-cta" style="display:inline-block;background:#DDA974;color:#FFFFFF;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;font-weight:700;line-height:120%;letter-spacing:0.5px;margin:0;text-decoration:none;text-transform:uppercase;padding:10px 25px;mso-padding-alt:0px;border-radius:10px;" target="_blank"
              >
                Get Started
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Eugenio Costa<br />832-900-9405<br />LyneSign.com</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#F4F4F4" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#F4F4F4;background-color:#F4F4F4;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#F4F4F4;background-color:#F4F4F4;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:16px;font-weight:700;line-height:1;text-align:center;color:#062A43;"
      >Get in touch</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1;text-align:center;color:#062A43;"
      ><a href="mailto:contact@lynesign.com" style="color:#062A43;">contact@lynesign.com</a></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      
     <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" ><tr><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#1877F2;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.facebook.com/LyneSign" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.facebook}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#0A66C2;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.linkedin.com/company/lynesign/" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.linkedin}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#E4405F;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.instagram.com/lynesign/" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.instagram}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FF0000;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.youtube.com/@LyneSignLLC" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.youtube}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td></tr></table><![endif]-->
    
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:20px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:12px;line-height:1;text-align:center;color:#C7CDD9;"
      >&#169; 2026 LyneSign. All rights reserved.</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><![endif]-->
    
    
      </div>
      </body>
    
</html>
  `,
  },
  {
    // Derived directly from the real lynesign.com/landing/ page (fetched
    // live): same hero headline, the same real "why advertisers choose
    // LyneSign" pillars and stats, and both CTA buttons point at the
    // landing page's actual lead-capture form anchor
    // (https://lynesign.com/landing/#final-cta) — the same form real
    // landing-page visitors fill out, not a separate/fake destination.
    key: "promo_landing_page_html",
    categoryKey: "marketing_promotions",
    sortOrder: 6,
    name: "Landing Page Follow-Up (Branded)",
    subject: "Be Seen Where Your Customers Are",
    bodyFormat: "HTML" as const,
    body: `<!doctype html>
<html lang="und" dir="auto" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <title></title>
    <!--[if !mso]><!-->
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <!--<![endif]-->
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style type="text/css">
      #outlook a { padding:0; }
      body { margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
      table, td { border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt; }
      img { border:0;height:auto;line-height:100%; outline:none;text-decoration:none;-ms-interpolation-mode:bicubic; }
      p { display:block;margin:13px 0; }
    </style>
    <!--[if mso]>
    <noscript>
    <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
    </xml>
    </noscript>
    <![endif]-->
    <!--[if lte mso 11]>
    <style type="text/css">
      .mj-outlook-group-fix { width:100% !important; }
    </style>
    <![endif]-->
    
      <!--[if !mso]><!-->
        <link href="https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700" rel="stylesheet" type="text/css">
        <style type="text/css">
          @import url(https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700);
        </style>
      <!--<![endif]-->

    
    
    <style type="text/css">
      @media only screen and (min-width:480px) {
        .mj-column-per-100 { width:100% !important; max-width: 100%; }
      }
    </style>
    <style media="screen and (min-width:480px)">
      .moz-text-html .mj-column-per-100 { width:100% !important; max-width: 100%; }
    </style>
    
    
  
    
    <style type="text/css">

    @media only screen and (max-width:479px) {
      table.mj-full-width-mobile { width: 100% !important; }
      td.mj-full-width-mobile { width: auto !important; }
    }
  
    </style>
    
    
  </head>
  
      <body  style="word-spacing:normal;background-color:#F4F4F4;">
        
        <div
           aria-roledescription="email" role="article" lang="und" dir="auto" style="word-spacing:normal;background-color:#F4F4F4;"
        >
        
      
      <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px 24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;"
      >
        <tbody>
          <tr>
            <td  style="width:160px;">
              
      <img
         alt="LyneSign" src="${LOGO_URL}" style="border:0;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;" width="160" height="auto"
      />
    
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;line-height:1;text-align:center;text-transform:uppercase;color:#DDA974;"
      >Indoor Digital Billboard Network · Texas</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;padding-top:8px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:28px;font-weight:700;line-height:1.25;text-align:center;color:#FFFFFF;"
      >Be Seen Where Your Customers Are</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;padding-top:8px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:center;color:#C7CDD9;"
      >Connect with your target audience through engaging, full-motion digital ads playing every day in our community.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:24px 0 0 0;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;"
      >
        <tbody>
          <tr>
            <td
               align="center" bgcolor="#DDA974" role="presentation" style="border:none;border-radius:10px;cursor:auto;mso-padding-alt:14px 32px;background:#DDA974;" valign="middle"
            >
              <a
                 href="https://lynesign.com/landing/#final-cta" style="display:inline-block;background:#DDA974;color:#FFFFFF;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;font-weight:700;line-height:120%;letter-spacing:0.5px;margin:0;text-decoration:none;text-transform:uppercase;padding:14px 32px;mso-padding-alt:0px;border-radius:10px;" target="_blank"
              >
                Get Started
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:40px 40px 16px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Hi {{first_name}},</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Your customers already spend real time inside local businesses — waiting, seated, browsing. LyneSign puts your message on the screens they're already looking at, with an average dwell time of <strong>49+ minutes</strong> across <strong>20+ screens live</strong> throughout Texas.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Why advertisers choose LyneSign:</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.8;text-align:left;color:#666666;"
      ><strong style="color:#062A43;">Be Seen</strong> — reach audiences inside local businesses where they're already spending time.<br/>
          <strong style="color:#062A43;">Stay Visible</strong> — full-motion ads that play all day and can't be paused, skipped, or blocked.<br/>
          <strong style="color:#062A43;">Target Your Audience</strong> — by location and by demographics, interests, and habits.</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;line-height:1;text-align:center;text-transform:uppercase;color:#DDA974;"
      >Ready When You Are</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;padding-top:4px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:20px;font-weight:700;line-height:1;text-align:center;color:#FFFFFF;"
      >Get your business seen</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:16px 0 0 0;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;"
      >
        <tbody>
          <tr>
            <td
               align="center" bgcolor="#DDA974" role="presentation" style="border:none;border-radius:10px;cursor:auto;mso-padding-alt:14px 32px;background:#DDA974;" valign="middle"
            >
              <a
                 href="https://lynesign.com/landing/#final-cta" style="display:inline-block;background:#DDA974;color:#FFFFFF;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;font-weight:700;line-height:120%;letter-spacing:0.5px;margin:0;text-decoration:none;text-transform:uppercase;padding:14px 32px;mso-padding-alt:0px;border-radius:10px;" target="_blank"
              >
                Get Started
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Eugenio Costa<br/>
          832-900-9405<br/>
          LyneSign.com</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#F4F4F4" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#F4F4F4;background-color:#F4F4F4;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#F4F4F4;background-color:#F4F4F4;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:16px;font-weight:700;line-height:1;text-align:center;color:#062A43;"
      >Get in touch</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1;text-align:center;color:#062A43;"
      ><a href="mailto:contact@lynesign.com" style="color:#062A43;">contact@lynesign.com</a></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      
     <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" ><tr><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#1877F2;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a href="https://www.facebook.com/LyneSign" target="_blank" style="display:block;width:32px;height:32px;line-height:32px;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.facebook}" width="18" height="18" alt="Facebook" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#0A66C2;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a href="https://www.linkedin.com/company/lynesign/" target="_blank" style="display:block;width:32px;height:32px;line-height:32px;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.linkedin}" width="18" height="18" alt="LinkedIn" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#E4405F;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a href="https://www.instagram.com/lynesign/" target="_blank" style="display:block;width:32px;height:32px;line-height:32px;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.instagram}" width="18" height="18" alt="Instagram" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FF0000;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a href="https://www.youtube.com/@LyneSignLLC" target="_blank" style="display:block;width:32px;height:32px;line-height:32px;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.youtube}" width="18" height="18" alt="YouTube" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td></tr></table><![endif]-->
    
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:20px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:12px;line-height:1;text-align:center;color:#C7CDD9;"
      >© 2026 LyneSign. All rights reserved.</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><![endif]-->
    
    
      </div>
      </body>
    
</html>
  `,
  },
  {
    // Derived directly from the real lynesign.com/screen-advertising/ page
    // (fetched live): the real "5 Benefits of Screen Network" copy (Local
    // Reach, Non-Skippable, Brand Recall, Update Your Message, Cross
    // Channel Complement) plus the real "YOUR AD HERE" restaurant-screen
    // photo from that same page. CTA points at the real screen-advertising
    // page, per request.
    key: "promo_screen_network_benefits_html",
    categoryKey: "marketing_promotions",
    sortOrder: 7,
    name: "5 Benefits of Screen Network (Branded)",
    subject: "5 Benefits of Screen Network",
    bodyFormat: "HTML" as const,
    body: `<!doctype html>
<html lang="und" dir="auto" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <title></title>
    <!--[if !mso]><!-->
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <!--<![endif]-->
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style type="text/css">
      #outlook a { padding:0; }
      body { margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
      table, td { border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt; }
      img { border:0;height:auto;line-height:100%; outline:none;text-decoration:none;-ms-interpolation-mode:bicubic; }
      p { display:block;margin:13px 0; }
    </style>
    <!--[if mso]>
    <noscript>
    <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
    </xml>
    </noscript>
    <![endif]-->
    <!--[if lte mso 11]>
    <style type="text/css">
      .mj-outlook-group-fix { width:100% !important; }
    </style>
    <![endif]-->
    
      <!--[if !mso]><!-->
        <link href="https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700" rel="stylesheet" type="text/css">
        <style type="text/css">
          @import url(https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700);
        </style>
      <!--<![endif]-->

    
    
    <style type="text/css">
      @media only screen and (min-width:480px) {
        .mj-column-per-100 { width:100% !important; max-width: 100%; }
      }
    </style>
    <style media="screen and (min-width:480px)">
      .moz-text-html .mj-column-per-100 { width:100% !important; max-width: 100%; }
    </style>
    
    
  
    
    <style type="text/css">

    @media only screen and (max-width:479px) {
      table.mj-full-width-mobile { width: 100% !important; }
      td.mj-full-width-mobile { width: auto !important; }
    }
  
    </style>
    
    
  </head>
  
      <body  style="word-spacing:normal;background-color:#F4F4F4;">
        
        <div
           aria-roledescription="email" role="article" lang="und" dir="auto" style="word-spacing:normal;background-color:#F4F4F4;"
        >
        
      
      <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px 24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;"
      >
        <tbody>
          <tr>
            <td  style="width:160px;">
              
      <img
         alt="LyneSign" src="${LOGO_URL}" style="border:0;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;" width="160" height="auto"
      />
    
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;line-height:1;text-align:center;text-transform:uppercase;color:#DDA974;"
      >Indoor Digital Billboard Network</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:28px;font-weight:700;line-height:1.25;text-align:center;color:#FFFFFF;"
      >5 Benefits of Screen Network</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:center;color:#C7CDD9;"
      >Connecting brands with audiences everywhere.</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:40px 40px 8px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Hi {{first_name}},</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Your personalized motion advertisement gets showcased repeatedly across our hyper-local digital screen network, reaching people as they go about their daily routines. With your name, brand, and logo prominently displayed, you'll stay top of mind with existing customers while building awareness with new ones.</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:8px 40px 40px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;"
      >
        <tbody>
          <tr>
            <td  style="width:520px;">
              
      <img
         alt="A real LyneSign ad playing on a screen inside a busy restaurant" src="https://lynesign.com/wp-content/uploads/2024/07/Local-Reach.jpg" style="border:0;border-radius:12px;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;" width="520" height="auto"
      />
    
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:0px 40px 40px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 16px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:18px;font-weight:700;line-height:1;text-align:left;color:#062A43;"
      >5 Benefits of Screen Network</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 14px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#666666;"
      ><strong style="color:#062A43;">Local Reach</strong><br />Advertising on a local network of digital signage screens strategically positioned in high-traffic areas offers businesses a direct channel to engage with their local audience, amplifying brand visibility in the immediate vicinity.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 14px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#666666;"
      ><strong style="color:#062A43;">Non-Skippable</strong><br />The inability to skip ads on these screens is advantageous as it guarantees continuous exposure to a captivated audience, enabling businesses to effectively convey their message.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 14px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#666666;"
      ><strong style="color:#062A43;">Brand Recall</strong><br />The repeated exposure to passersby on local digital signage networks creates greater brand recall compared to other marketing channels, keeping your business prominent in the minds of your target audience.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 14px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#666666;"
      ><strong style="color:#062A43;">Update Your Message</strong><br />The ability to promptly adjust your marketing message gives you the flexibility to respond to changing market dynamics and seize opportunities the moment they come up.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#666666;"
      ><strong style="color:#062A43;">Cross Channel Complement</strong><br />It's the perfect addition to your other marketing channels — this integrated strategy guarantees an expansive marketing reach and deeper engagement across multiple platforms.</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 4px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;line-height:1;text-align:center;text-transform:uppercase;color:#DDA974;"
      >Ready When You Are</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:20px;font-weight:700;line-height:1;text-align:center;color:#FFFFFF;"
      >See how your ad could look</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;"
      >
        <tbody>
          <tr>
            <td
               align="center" bgcolor="#DDA974" role="presentation" style="border:none;border-radius:10px;cursor:auto;mso-padding-alt:10px 25px;background:#DDA974;" valign="middle"
            >
              <a
                 href="https://lynesign.com/landing/#final-cta" style="display:inline-block;background:#DDA974;color:#FFFFFF;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;font-weight:700;line-height:120%;letter-spacing:0.5px;margin:0;text-decoration:none;text-transform:uppercase;padding:10px 25px;mso-padding-alt:0px;border-radius:10px;" target="_blank"
              >
                Get Started
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Eugenio Costa<br />832-900-9405<br />LyneSign.com</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1;text-align:left;color:#666666;"
      >Need help? <a href="https://lynesign.com/contact-us/#" style="color:#DDA974;font-weight:700;text-decoration:none;">Contact support</a></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#F4F4F4" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#F4F4F4;background-color:#F4F4F4;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#F4F4F4;background-color:#F4F4F4;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:16px;font-weight:700;line-height:1;text-align:center;color:#062A43;"
      >Get in touch</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1;text-align:center;color:#062A43;"
      ><a href="mailto:contact@lynesign.com" style="color:#062A43;">contact@lynesign.com</a></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      
     <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" ><tr><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#1877F2;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.facebook.com/LyneSign" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.facebook}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#0A66C2;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.linkedin.com/company/lynesign/" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.linkedin}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#E4405F;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.instagram.com/lynesign/" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.instagram}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FF0000;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.youtube.com/@LyneSignLLC" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.youtube}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td></tr></table><![endif]-->
    
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:20px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:12px;line-height:1;text-align:center;color:#C7CDD9;"
      >&#169; 2026 LyneSign. All rights reserved.</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><![endif]-->
    
    
      </div>
      </body>
    
</html>
  `,
  },
  {
    // Derived directly from the real lynesign.com/google-business-profile/
    // page (fetched live): the real service description plus all 4 real
    // "Boosting Visibility" pillars (Dedicated Specialist, Posting, Review
    // Management, Optimization) and the real phone-showing-a-GBP-listing
    // photo from that same page. CTA points at the real service page.
    key: "promo_google_business_profile_html",
    categoryKey: "marketing_promotions",
    sortOrder: 8,
    name: "Google Business Profile (Branded)",
    subject: "Your Google Business Profile, Managed",
    bodyFormat: "HTML" as const,
    body: `<!doctype html>
<html lang="und" dir="auto" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <title></title>
    <!--[if !mso]><!-->
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <!--<![endif]-->
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style type="text/css">
      #outlook a { padding:0; }
      body { margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
      table, td { border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt; }
      img { border:0;height:auto;line-height:100%; outline:none;text-decoration:none;-ms-interpolation-mode:bicubic; }
      p { display:block;margin:13px 0; }
    </style>
    <!--[if mso]>
    <noscript>
    <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
    </xml>
    </noscript>
    <![endif]-->
    <!--[if lte mso 11]>
    <style type="text/css">
      .mj-outlook-group-fix { width:100% !important; }
    </style>
    <![endif]-->
    
      <!--[if !mso]><!-->
        <link href="https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700" rel="stylesheet" type="text/css">
        <style type="text/css">
          @import url(https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700);
        </style>
      <!--<![endif]-->

    
    
    <style type="text/css">
      @media only screen and (min-width:480px) {
        .mj-column-per-100 { width:100% !important; max-width: 100%; }
      }
    </style>
    <style media="screen and (min-width:480px)">
      .moz-text-html .mj-column-per-100 { width:100% !important; max-width: 100%; }
    </style>
    
    
  
    
    <style type="text/css">

    @media only screen and (max-width:479px) {
      table.mj-full-width-mobile { width: 100% !important; }
      td.mj-full-width-mobile { width: auto !important; }
    }
  
    </style>
    
    
  </head>
  
      <body  style="word-spacing:normal;background-color:#F4F4F4;">
        
        <div
           aria-roledescription="email" role="article" lang="und" dir="auto" style="word-spacing:normal;background-color:#F4F4F4;"
        >
        
      
      <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px 24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;"
      >
        <tbody>
          <tr>
            <td  style="width:160px;">
              
      <img
         alt="LyneSign" src="${LOGO_URL}" style="border:0;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;" width="160" height="auto"
      />
    
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;line-height:1;text-align:center;text-transform:uppercase;color:#DDA974;"
      >Marketing Solutions</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:28px;font-weight:700;line-height:1.25;text-align:center;color:#FFFFFF;"
      >Your Google Business Profile, Managed</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:center;color:#C7CDD9;"
      >Boost your performance so you appear on more relevant search results.</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:40px 40px 8px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Hi {{first_name}},</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Your Google Business Profile is often a customer's first online exposure to your business. Our Google Business Profile Management service gives you a dedicated account specialist who handles everything from weekly posts to photo uploads — so your Google presence is professionally managed while you focus on running your business.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1;text-align:left;color:#666666;"
      >Need help? <a href="https://lynesign.com/contact-us/#" style="color:#DDA974;font-weight:700;text-decoration:none;">Contact support</a></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:8px 40px 40px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;"
      >
        <tbody>
          <tr>
            <td  style="width:520px;">
              
      <img
         alt="A person checking their Google Business Profile listing on their phone" src="https://lynesign.com/wp-content/uploads/2024/07/Google-Management.webp" style="border:0;border-radius:12px;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;" width="520" height="auto"
      />
    
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:0px 40px 40px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 16px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:18px;font-weight:700;line-height:1;text-align:left;color:#062A43;"
      >Boosting Visibility With Google Business Profile</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 14px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#666666;"
      ><strong style="color:#062A43;">Dedicated Specialist</strong><br />A dedicated specialist works alongside you to keep your profile up to date and optimized, with regular report calls to keep you looped in.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 14px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#666666;"
      ><strong style="color:#062A43;">Posting</strong><br />We post unique content up to 20 times per month to boost local search visibility, build trust, and encourage customers to engage with you online.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 14px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#666666;"
      ><strong style="color:#062A43;">Review Management</strong><br />We respond to reviews with keyword-rich text in your brand voice, building trust and maintaining a positive online reputation.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;text-align:left;color:#666666;"
      ><strong style="color:#062A43;">Optimization</strong><br />We claim and verify your listings and keep your information consistent across Google Maps and other directories, so customers always find accurate details.</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 4px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;line-height:1;text-align:center;text-transform:uppercase;color:#DDA974;"
      >Ready When You Are</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:20px;font-weight:700;line-height:1;text-align:center;color:#FFFFFF;"
      >Let's get your profile working for you</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;"
      >
        <tbody>
          <tr>
            <td
               align="center" bgcolor="#DDA974" role="presentation" style="border:none;border-radius:10px;cursor:auto;mso-padding-alt:10px 25px;background:#DDA974;" valign="middle"
            >
              <a
                 href="https://lynesign.com/landing/#final-cta" style="display:inline-block;background:#DDA974;color:#FFFFFF;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;font-weight:700;line-height:120%;letter-spacing:0.5px;margin:0;text-decoration:none;text-transform:uppercase;padding:10px 25px;mso-padding-alt:0px;border-radius:10px;" target="_blank"
              >
                Get Started
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Eugenio Costa<br />832-900-9405<br />LyneSign.com</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#F4F4F4" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#F4F4F4;background-color:#F4F4F4;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#F4F4F4;background-color:#F4F4F4;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:16px;font-weight:700;line-height:1;text-align:center;color:#062A43;"
      >Get in touch</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1;text-align:center;color:#062A43;"
      ><a href="mailto:contact@lynesign.com" style="color:#062A43;">contact@lynesign.com</a></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      
     <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" ><tr><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#1877F2;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.facebook.com/LyneSign" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.facebook}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#0A66C2;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.linkedin.com/company/lynesign/" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.linkedin}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#E4405F;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.instagram.com/lynesign/" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.instagram}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FF0000;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.youtube.com/@LyneSignLLC" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.youtube}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td></tr></table><![endif]-->
    
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:20px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:12px;line-height:1;text-align:center;color:#C7CDD9;"
      >&#169; 2026 LyneSign. All rights reserved.</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><![endif]-->
    
    
      </div>
      </body>
    
</html>
  `,
  },

  // --- Onboarding / Welcome ---
  {
    key: "welcome_new_signup",
    categoryKey: "onboarding_welcome",
    sortOrder: 1,
    name: "Welcome Email — New Signup",
    subject: "Welcome, {{first_name}}!",
    body: `<p>Hi {{first_name}},</p><p>Welcome aboard — we're glad you're here. Here's what to expect next:</p><ul><li>[First step]</li><li>[Second step]</li></ul><p>If you have any questions along the way, just reply to this email.</p>`,
  },
  {
    key: "welcome_getting_started_guide",
    categoryKey: "onboarding_welcome",
    sortOrder: 2,
    name: "Getting Started Guide",
    subject: "Getting started with [Product]",
    body: `<p>Hi {{first_name}},</p><p>Here's a quick guide to get you up and running with [Product]:</p><ol><li>[Step one]</li><li>[Step two]</li><li>[Step three]</li></ol><p><a href="[link]">Get started now</a></p>`,
  },
  {
    key: "welcome_to_business",
    categoryKey: "onboarding_welcome",
    sortOrder: 3,
    name: "Welcome to [Business Name]",
    subject: "Welcome to the family, {{first_name}}",
    body: `<p>Hi {{first_name}},</p><p>Thanks so much for joining us. We started this because [brief story/mission], and we're excited to have you here.</p><p>Here's a good place to start: <a href="[link]">[link text]</a></p>`,
  },
  {
    key: "welcome_account_setup_checklist",
    categoryKey: "onboarding_welcome",
    sortOrder: 4,
    name: "Account Setup Checklist",
    subject: "Finish setting up your account",
    body: `<p>Hi {{first_name}},</p><p>You're almost set up — just a few things left:</p><ul><li>[ ] [Setup step #1]</li><li>[ ] [Setup step #2]</li><li>[ ] [Setup step #3]</li></ul><p><a href="[link]">Finish setup</a></p>`,
  },
  {
    // Branded HTML/MJML version — a customer's first impression matters
    // most here, same real compile pipeline as the other HTML examples.
    key: "welcome_new_signup_html",
    categoryKey: "onboarding_welcome",
    sortOrder: 5,
    name: "Welcome Email (Branded)",
    subject: "Welcome to LyneSign!",
    bodyFormat: "HTML" as const,
    body: `<!doctype html>
<html lang="und" dir="auto" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <title></title>
    <!--[if !mso]><!-->
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <!--<![endif]-->
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style type="text/css">
      #outlook a { padding:0; }
      body { margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
      table, td { border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt; }
      img { border:0;height:auto;line-height:100%; outline:none;text-decoration:none;-ms-interpolation-mode:bicubic; }
      p { display:block;margin:13px 0; }
    </style>
    <!--[if mso]>
    <noscript>
    <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
    </xml>
    </noscript>
    <![endif]-->
    <!--[if lte mso 11]>
    <style type="text/css">
      .mj-outlook-group-fix { width:100% !important; }
    </style>
    <![endif]-->
    
      <!--[if !mso]><!-->
        <link href="https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700" rel="stylesheet" type="text/css">
        <style type="text/css">
          @import url(https://fonts.googleapis.com/css?family=Ubuntu:300,400,500,700);
        </style>
      <!--<![endif]-->

    
    
    <style type="text/css">
      @media only screen and (min-width:480px) {
        .mj-column-per-100 { width:100% !important; max-width: 100%; }
      }
    </style>
    <style media="screen and (min-width:480px)">
      .moz-text-html .mj-column-per-100 { width:100% !important; max-width: 100%; }
    </style>
    
    
  
    
    <style type="text/css">

    @media only screen and (max-width:479px) {
      table.mj-full-width-mobile { width: 100% !important; }
      td.mj-full-width-mobile { width: auto !important; }
    }
  
    </style>
    
    
  </head>
  
      <body  style="word-spacing:normal;background-color:#F4F4F4;">
        
        <div
           aria-roledescription="email" role="article" lang="und" dir="auto" style="word-spacing:normal;background-color:#F4F4F4;"
        >
        
      
      <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px 24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;"
      >
        <tbody>
          <tr>
            <td  style="width:160px;">
              
      <img
         alt="LyneSign" src="${LOGO_URL}" style="border:0;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;" width="160" height="auto"
      />
    
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;line-height:1;text-align:center;text-transform:uppercase;color:#DDA974;"
      >Indoor Digital Billboard Network &middot; Texas</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:28px;font-weight:700;line-height:1.25;text-align:center;color:#FFFFFF;"
      >Welcome to LyneSign</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:center;color:#C7CDD9;"
      >Be seen where your customers eat, work, shop, and play.</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:40px 40px 8px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Hi {{first_name}},</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Thanks for signing up. LyneSign puts your brand story on indoor digital billboards across the venues your customers already spend time in — vibrant, full-motion screens that play all day and can't be skipped or blocked.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.8;text-align:left;color:#666666;"
      ><strong style="color:#062A43;">400%</strong> more impactful than static advertising.<br /><strong style="color:#062A43;">33%</strong> increase in average ticket value.<br /><strong style="color:#062A43;">83%</strong> recall among consumers.</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1;text-align:left;color:#666666;"
      ><a href="https://lynesign.com/contact-us/#" style="color:#DDA974;font-weight:700;text-decoration:none;">Need help? Contact support</a></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:8px 40px 40px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0;word-break:break-word;"
                >
                  
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;border-spacing:0px;"
      >
        <tbody>
          <tr>
            <td  style="width:520px;">
              
      <img
         alt="A real LyneSign indoor digital billboard playing inside a Houston venue" src="https://lynesign.com/wp-content/uploads/2024/07/Indoor-Billboards.webp" style="border:0;border-radius:12px;display:block;outline:none;text-decoration:none;height:auto;width:100%;font-size:13px;" width="520" height="auto"
      />
    
            </td>
          </tr>
        </tbody>
      </table>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:0px 40px 40px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1;text-align:left;color:#666666;"
      >Thank you,<br />The LyneSign Team</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#F4F4F4" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#F4F4F4;background-color:#F4F4F4;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#F4F4F4;background-color:#F4F4F4;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:32px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:0 0 10px 0;word-break:break-word;"
                >
                  
      <div
         style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:16px;font-weight:700;line-height:1;text-align:center;color:#062A43;"
      >Get in touch</div>
    
                </td>
              </tr>
            
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1;text-align:center;color:#062A43;"
      ><a href="mailto:contact@lynesign.com" style="color:#062A43;">contact@lynesign.com</a></div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#FFFFFF;background-color:#FFFFFF;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;background-color:#FFFFFF;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:24px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      
     <!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" ><tr><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#1877F2;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.facebook.com/LyneSign" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.facebook}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#0A66C2;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.linkedin.com/company/lynesign/" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.linkedin}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#E4405F;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.instagram.com/lynesign/" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.instagram}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td><td><![endif]-->
              <table
                 align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:none;display:inline-table;"
              >
                <tbody>
                  
      <tr
        
      >
        
        <td  style="padding:4px;vertical-align:middle;">
          <table
             border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#FF0000;border-radius:16px;width:32px;"
          >
            <tbody>
              <tr>
                <td  style="font-size:0;height:32px;vertical-align:middle;width:32px;">
                  <a  href="https://www.youtube.com/@LyneSignLLC" target="_blank">
                    <img
                       alt="" src="${SOCIAL_ICON_URLS.youtube}" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" width="18"
                    />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </td>
       
        
      
      </tr>
    
                </tbody>
              </table>
            <!--[if mso | IE]></td></tr></table><![endif]-->
    
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" class="" role="presentation" style="width:600px;" width="600" bgcolor="#062A43" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->
    
      
      <div  style="background:#062A43;background-color:#062A43;margin:0px auto;max-width:600px;">
        
        <table
           align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background:#062A43;background-color:#062A43;width:100%;"
        >
          <tbody>
            <tr>
              <td
                 style="direction:ltr;font-size:0px;padding:20px 40px;text-align:center;"
              >
                <!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td class="" style="vertical-align:top;width:520px;" ><![endif]-->
            
      <div
         class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%;"
      >
        
      <table
         border="0" cellpadding="0" cellspacing="0" role="presentation" style="vertical-align:top;" width="100%"
      >
        <tbody>
          
              <tr>
                <td
                   align="center" style="font-size:0px;padding:10px 25px;word-break:break-word;"
                >
                  
      <div
         style="font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:12px;line-height:1;text-align:center;color:#C7CDD9;"
      >&#169; 2026 LyneSign. All rights reserved.</div>
    
                </td>
              </tr>
            
        </tbody>
      </table>
    
      </div>
    
          <!--[if mso | IE]></td></tr></table><![endif]-->
              </td>
            </tr>
          </tbody>
        </table>
        
      </div>
    
      
      <!--[if mso | IE]></td></tr></table><![endif]-->
    
    
      </div>
      </body>
    
</html>
  `,
  },

  // --- Re-engagement / Win-back ---
  {
    key: "winback_we_miss_you",
    categoryKey: "reengagement_winback",
    sortOrder: 1,
    name: "We Miss You",
    subject: "We miss you, {{first_name}}",
    body: `<p>Hi {{first_name}},</p><p>It's been a while since we've seen you, and we wanted to check in. A lot has changed since your last visit — [what's new].</p><p><a href="[link]">Come see what's new</a></p>`,
  },
  {
    key: "winback_special_offer",
    categoryKey: "reengagement_winback",
    sortOrder: 2,
    name: "Special Offer to Win You Back",
    subject: "Here's 15% off to come back",
    body: `<p>Hi {{first_name}},</p><p>We'd love to have you back — here's <strong>15% off</strong> your next [purchase/order] as a thank-you.</p><p>Use code <strong>[CODE]</strong> before [date].</p><p><a href="[link]">Redeem your offer</a></p>`,
  },
  {
    key: "winback_last_chance",
    categoryKey: "reengagement_winback",
    sortOrder: 3,
    name: "Last Chance Before We Say Goodbye",
    subject: "Should we stop emailing you?",
    body: `<p>Hi {{first_name}},</p><p>We haven't heard from you in a while, and we don't want to clutter your inbox if this isn't useful anymore.</p><p>If you'd like to stay, just click below and we'll keep you posted. Otherwise, no hard feelings — we'll stop reaching out.</p><p><a href="[link]">Keep me subscribed</a></p>`,
  },
  {
    key: "winback_whats_new",
    categoryKey: "reengagement_winback",
    sortOrder: 4,
    name: "Here's What You've Missed",
    subject: "Here's what's new since you've been away",
    body: `<p>Hi {{first_name}},</p><p>Since you've been away, we've added:</p><ul><li>[New feature or update #1]</li><li>[New feature or update #2]</li></ul><p><a href="[link]">Take another look</a></p>`,
  },

  // --- Appointment Reminders ---
  {
    key: "appt_reminder_24h",
    categoryKey: "appointment_reminders",
    sortOrder: 1,
    name: "Appointment Reminder — 24 Hours",
    subject: "Reminder: your appointment is tomorrow",
    body: `<p>Hi {{first_name}},</p><p>Just a reminder that your appointment is scheduled for <strong>[date] at [time]</strong>.</p><p>[Any preparation instructions, if needed.]</p><p>Need to reschedule? <a href="[link]">Click here</a>.</p>`,
  },
  {
    key: "appt_confirmation",
    categoryKey: "appointment_reminders",
    sortOrder: 2,
    name: "Appointment Confirmation",
    subject: "You're confirmed for [Date]",
    body: `<p>Hi {{first_name}},</p><p>This confirms your appointment on <strong>[date] at [time]</strong>.</p><p>Location/details: [location or call link]</p><p>We look forward to seeing you — reply if anything needs to change.</p>`,
  },
  {
    key: "appt_reschedule_request",
    categoryKey: "appointment_reminders",
    sortOrder: 3,
    name: "Reschedule Request",
    subject: "Need to reschedule your appointment?",
    body: `<p>Hi {{first_name}},</p><p>If <strong>[date] at [time]</strong> no longer works for you, no problem — you can pick a new time here:</p><p><a href="[link]">Reschedule my appointment</a></p>`,
  },
  {
    key: "appt_followup",
    categoryKey: "appointment_reminders",
    sortOrder: 4,
    name: "Appointment Follow-up",
    subject: "Thanks for stopping by, {{first_name}}",
    body: `<p>Hi {{first_name}},</p><p>Thanks for taking the time to meet with us. Here's a quick recap of what we discussed and the next steps:</p><ul><li>[Next step #1]</li><li>[Next step #2]</li></ul><p>Let us know if you have any questions in the meantime.</p>`,
  },

  // --- Thank You / Receipts ---
  {
    key: "thanks_for_purchase",
    categoryKey: "thank_you_receipts",
    sortOrder: 1,
    name: "Thank You for Your Purchase",
    subject: "Thank you for your order, {{first_name}}!",
    body: `<p>Hi {{first_name}},</p><p>Thank you for your recent purchase — we really appreciate it.</p><p>Here's what happens next: [shipping/delivery/access details].</p><p>Questions? Just reply to this email and we'll help right away.</p>`,
  },
  {
    key: "thanks_payment_receipt",
    categoryKey: "thank_you_receipts",
    sortOrder: 2,
    name: "Payment Receipt",
    subject: "Your payment receipt",
    body: `<p>Hi {{first_name}},</p><p>This confirms your payment was successfully processed.</p><ul><li>Amount: [amount]</li><li>Date: [date]</li><li>Payment method: [method]</li></ul><p>Keep this email for your records. Reply if you have any questions.</p>`,
  },
  {
    key: "thanks_for_business",
    categoryKey: "thank_you_receipts",
    sortOrder: 3,
    name: "Thank You for Your Business",
    subject: "Thank you, {{first_name}}",
    body: `<p>Hi {{first_name}},</p><p>We just wanted to say thank you for choosing to work with us — it means a lot.</p><p>If you know anyone else who might benefit from what we do, we'd love an introduction.</p>`,
  },
  {
    key: "thanks_order_confirmation",
    categoryKey: "thank_you_receipts",
    sortOrder: 4,
    name: "Order Confirmation",
    subject: "Your order is confirmed",
    body: `<p>Hi {{first_name}},</p><p>Your order <strong>[order number]</strong> is confirmed.</p><p>[Shipping/delivery details or next steps.]</p><p>We'll send another update once it's on its way.</p>`,
  },

  // --- Business / General ---
  {
    key: "general_announcement",
    categoryKey: "business_general",
    sortOrder: 1,
    name: "General Announcement",
    subject: "An update from us",
    body: `<p>Hi {{first_name}},</p><p>We wanted to share an update: [announcement details].</p><p>[What this means for the recipient, if relevant.]</p><p>Let us know if you have any questions.</p>`,
  },
  {
    key: "general_meeting_followup",
    categoryKey: "business_general",
    sortOrder: 2,
    name: "Follow-Up After a Meeting",
    subject: "Great speaking with you, {{first_name}}",
    body: `<p>Hi {{first_name}},</p><p>Thanks again for the time today — really enjoyed the conversation.</p><p>As discussed, here are the next steps:</p><ul><li>[Next step #1]</li><li>[Next step #2]</li></ul><p>Looking forward to continuing the conversation.</p>`,
  },
  {
    key: "general_check_in",
    categoryKey: "business_general",
    sortOrder: 3,
    name: "Simple Check-In",
    subject: "Checking in, {{first_name}}",
    body: `<p>Hi {{first_name}},</p><p>Just wanted to check in and see how things are going on your end with [topic].</p><p>Happy to help with anything — just let me know.</p>`,
  },
  {
    key: "general_networking_intro",
    categoryKey: "business_general",
    sortOrder: 4,
    name: "Introduction / Networking Email",
    subject: "Introducing myself",
    body: `<p>Hi {{first_name}},</p><p>My name is [Your Name], and I [brief context — how you found them or a shared connection].</p><p>I'd love to connect and learn more about what you're working on at {{company}}. Would you be open to a short call sometime?</p>`,
  },
  {
    // The real, full table-based branded template — restructured to match
    // email-templates/lynesign-branded-template.html's 8-section layout
    // (header, hero band, body, media block, sign-off, contact band, social
    // row, footer bar), with realistic example copy filled in (matching
    // every other starter template's "real example text + [bracketed]
    // manual-fill markers" convention) in place of that file's bare
    // {curly_brace} placeholders. bodyFormat: HTML routes this through
    // composeEmail.ts's wider sanitizer (tables/images/a <style> block
    // survive) instead of the plain-text rich-text allowlist.
    // The standalone file's own {unsubscribe_link} in the contact band is
    // dropped here — the app already appends a real unsubscribe footer
    // automatically (Campaign.unsubscribeFooterEnabled), so keeping both
    // would double up.
    key: "business_lynesign_branded",
    categoryKey: "business_general",
    sortOrder: 5,
    name: "LyneSign Branded Announcement",
    subject: "Get Seen Where It Matters Most",
    bodyFormat: "HTML" as const,
    body: `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>LyneSign</title>
<style>
  body, table, td { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
  body { margin: 0; padding: 0; width: 100% !important; background-color: #F4F4F4; }

  @media only screen and (max-width: 600px) {
    .email-container { width: 100% !important; max-width: 100% !important; }
    .mobile-pad { padding-left: 24px !important; padding-right: 24px !important; }
    .hero-heading { font-size: 24px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F4;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F4F4F4;">
    Indoor digital billboards that put your brand where your customers already are.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F4F4;">
    <tr>
      <td align="center" style="padding:24px 16px;">

        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:600px;max-width:600px;background-color:#FFFFFF;">

          <!-- 1. Header -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:32px 40px 24px 40px;background-color:#FFFFFF;">
              <img src="${LOGO_URL}" width="160" alt="LyneSign" style="display:block;border:0;width:160px;max-width:100%;">
            </td>
          </tr>

          <!-- 2. Hero band -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:40px 40px;background-color:#062A43;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom:16px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="48" height="48" align="center" valign="middle" style="width:48px;height:48px;border-radius:24px;border:2px solid #DDA974;font-size:20px;line-height:44px;color:#DDA974;font-family:Arial,sans-serif;">
                          &#9678;
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <h1 class="hero-heading" style="margin:0;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:26px;line-height:1.3;font-weight:700;color:#FFFFFF;">
                Get Seen Where It Matters Most
              </h1>
            </td>
          </tr>

          <!-- 3. Body -->
          <tr>
            <td class="mobile-pad" style="padding:40px 40px 8px 40px;background-color:#FFFFFF;">
              <p style="margin:0 0 16px 0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.6;color:#666666;">
                Hi {{first_name}},
              </p>
              <p style="margin:0 0 16px 0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.6;color:#666666;">
                LyneSign puts your brand on indoor digital billboards across Houston — the screens your customers are already looking at while they eat, shop, wait, and play. Every display is strategically placed to deliver vibrant, memorable visuals to a captive, local audience.
              </p>
              <p style="margin:0 0 20px 0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.6;color:#666666;">
                <strong style="color:#062A43;">400%</strong> more impactful than static advertising. <strong style="color:#062A43;">33%</strong> increase in average ticket value. <strong style="color:#062A43;">83%</strong> recall among consumers.
              </p>
              <p style="margin:0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;color:#666666;">
                Need help? <a href="https://lynesign.com/contact-us/#" style="color:#DDA974;font-weight:700;text-decoration:none;">Contact support</a>
              </p>
            </td>
          </tr>

          <!-- 4. Media block -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:8px 40px 8px 40px;background-color:#FFFFFF;">
              <img src="https://lynesign.com/wp-content/uploads/2024/07/Indoor-Billboards.webp" width="520" alt="A real LyneSign indoor digital billboard playing inside a Houston venue" style="display:block;width:100%;max-width:520px;border-radius:12px;">
            </td>
          </tr>

          <!-- 5. Sign-off -->
          <tr>
            <td class="mobile-pad" style="padding:24px 40px 40px 40px;background-color:#FFFFFF;">
              <p style="margin:0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.6;color:#666666;">
                Thank you,<br>
                The LyneSign Team
              </p>
            </td>
          </tr>

          <!-- 6. Contact band -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:32px 40px;background-color:#F4F4F4;">
              <p style="margin:0 0 8px 0;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:16px;font-weight:700;color:#062A43;">
                Get in touch
              </p>
              <p style="margin:0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;">
                <a href="mailto:contact@lynesign.com" style="color:#062A43;text-decoration:underline;">contact@lynesign.com</a>
              </p>
            </td>
          </tr>

          <!-- 7. Social icons row -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:24px 40px;background-color:#FFFFFF;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 6px;">
                    <a href="https://www.facebook.com/LyneSign" target="_blank" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:#1877F2;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.facebook}" width="18" height="18" alt="Facebook" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                  </td>
                  <td style="padding:0 6px;">
                    <a href="https://www.linkedin.com/company/lynesign/" target="_blank" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:#0A66C2;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.linkedin}" width="18" height="18" alt="LinkedIn" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                  </td>
                  <td style="padding:0 6px;">
                    <a href="https://www.instagram.com/lynesign/" target="_blank" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:#E4405F;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.instagram}" width="18" height="18" alt="Instagram" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                  </td>
                  <td style="padding:0 6px;">
                    <a href="https://www.youtube.com/@LyneSignLLC" target="_blank" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:#FF0000;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.youtube}" width="18" height="18" alt="YouTube" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- 8. Footer bar -->
          <tr>
            <td align="center" style="padding:20px 40px;background-color:#062A43;">
              <p style="margin:0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:12px;line-height:1.6;color:#C7CDD9;">
                &copy; 2026 LyneSign. All rights reserved.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`,
  },
  {
    // Introduces LyneSign by name as Houston's indoor digital billboard
    // company, using the same 8-section branded structure as the entry
    // above plus one extra section: a real 3x2 photo mosaic pulled straight
    // from lynesign.com/landing/ (that page inlines the photos as base64
    // with no public URLs of their own, so they were extracted, decoded,
    // and saved as public/mosaic-*.jpg — the exact same "real, hosted
    // asset under public/" pattern LOGO_URL/SOCIAL_ICON_URLS already use).
    // proxy.ts's PUBLIC_PATHS needed a matching "/mosaic-" entry so these
    // load for a real, logged-out recipient's mail client, not just an
    // authenticated preview — same reasoning already documented there for
    // /logo.png and /social/.
    key: "business_lynesign_intro_houston",
    categoryKey: "business_general",
    sortOrder: 6,
    name: "LyneSign Introduction — Houston",
    subject: "Be Seen Where Your Customers Already Are",
    bodyFormat: "HTML" as const,
    body: `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>LyneSign</title>
<style>
  body, table, td { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
  body { margin: 0; padding: 0; width: 100% !important; background-color: #F4F4F4; }

  @media only screen and (max-width: 600px) {
    .email-container { width: 100% !important; max-width: 100% !important; }
    .mobile-pad { padding-left: 24px !important; padding-right: 24px !important; }
    .hero-heading { font-size: 24px !important; }
    .mosaic-cell { width: 50% !important; display: inline-block !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F4;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F4F4F4;">
    Houston's indoor digital billboard network — real screens, inside real local businesses.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F4F4;">
    <tr>
      <td align="center" style="padding:24px 16px;">

        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:600px;max-width:600px;background-color:#FFFFFF;">

          <!-- 1. Header -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:32px 40px 24px 40px;background-color:#FFFFFF;">
              <img src="${LOGO_URL}" width="160" alt="LyneSign" style="display:block;border:0;width:160px;max-width:100%;">
            </td>
          </tr>

          <!-- 2. Hero band -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:40px 40px;background-color:#062A43;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom:14px;">
                    <p style="margin:0;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#DDA974;">
                      Indoor Digital Billboard Network &middot; Houston, TX
                    </p>
                  </td>
                </tr>
              </table>
              <h1 class="hero-heading" style="margin:0;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:28px;line-height:1.3;font-weight:700;color:#FFFFFF;">
                Be Seen Where Your Customers Already Are
              </h1>
            </td>
          </tr>

          <!-- 3. Body intro -->
          <tr>
            <td class="mobile-pad" style="padding:40px 40px 8px 40px;background-color:#FFFFFF;">
              <p style="margin:0 0 16px 0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.6;color:#666666;">
                Hi {{first_name}},
              </p>
              <p style="margin:0 0 16px 0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.6;color:#666666;">
                LyneSign is Houston's indoor digital billboard network — full-motion advertising playing on real screens inside the local businesses your customers already spend time in. Not a few seconds glimpsed from a car window, but minutes spent waiting, browsing, or working out, with your brand right in front of them.
              </p>
              <ul style="margin:0;padding-left:20px;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.6;color:#666666;">
                <li style="margin:0 0 6px 0;"><strong style="color:#062A43;">20+</strong> screens live across Texas</li>
                <li style="margin:0 0 6px 0;"><strong style="color:#062A43;">49+</strong> minute average dwell time</li>
                <li style="margin:0;"><strong style="color:#062A43;">Houston</strong> locations available now</li>
              </ul>
            </td>
          </tr>

          <!-- 4. Mosaic -->
          <tr>
            <td class="mobile-pad" style="padding:28px 40px 8px 40px;background-color:#FFFFFF;">
              <p style="margin:0 0 16px 0;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:16px;font-weight:700;color:#062A43;">
                Real LyneSign Screens, Inside Real Texas Businesses
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="mosaic-cell" width="33.33%" valign="top" style="padding:0 4px 8px 0;">
                    <img src="data:image/jpeg;base64,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" width="170" alt="LyneSign digital screen inside a Houston barber shop, visible through the storefront window." style="display:block;width:100%;max-width:170px;border-radius:8px;">
                  </td>
                  <td class="mosaic-cell" width="33.33%" valign="top" style="padding:0 4px 8px 4px;">
                    <img src="data:image/jpeg;base64,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" width="170" alt="LyneSign screen playing a local advertisement inside All Day Collision Center's office." style="display:block;width:100%;max-width:170px;border-radius:8px;">
                  </td>
                  <td class="mosaic-cell" width="33.33%" valign="top" style="padding:0 0 8px 4px;">
                    <img src="data:image/jpeg;base64,/9j/2wBDAAoKCgoKCgsMDAsPEA4QDxYUExMUFiIYGhgaGCIzICUgICUgMy03LCksNy1RQDg4QFFeT0pPXnFlZXGPiI+7u/v/2wBDAQoKCgoKCgsMDAsPEA4QDxYUExMUFiIYGhgaGCIzICUgICUgMy03LCksNy1RQDg4QFFeT0pPXnFlZXGPiI+7u/v/wgARCACfAVQDASIAAhEBAxEB/8QAGwAAAQUBAQAAAAAAAAAAAAAABAACAwUGBwH/xAAZAQEBAQEBAQAAAAAAAAAAAAAAAQIDBAX/2gAMAwEAAhADEAAAANV5ka3ldqbzuU24QFwUjNurMCPv3LzlnQQExXmlEKXy2HoL2bwi9l3UYF3XKqOc+7GsqiRMVMc5V4vfTxe+DXeNJPWNpzPEeRvYeR+wEirUbc1NxXiWV6Y8kmrNRX504Gg0E0UFo/yrWQCyQJwVQaYfOFGptqMuL6TGn5aL3n0sbwHPzktCPR7Ru990co2VJ5ECWLc/Et7WKyjPjG5ncsBnk0Ki0d3H5Y/m3oGaPNCXnTZdTXAFjTw0S1dpemCM0gyKe1ZGZVm0YWNmavaINUo5fKj8c0888Aqw8ztfJrarM2U2kfLjvEPcEc+1TcV5PTzBYvoPP+vG3JMlqrRaL2YF8ExQMsIvcx0vncwDtPE5mrGHYdxjwY+NBctQAmr9w1Vb16v5a06QudOOg+YTW5619YH5vjH7OZQ09uXln5bcTO0dVRcu+muueS9eXQaHKwaxoMJZ9e1MBN1Ke65qtavO5q4b30ZNcNa5V/Sae/xak7Mn3OYt9fncds/G8TpyKjHis9FUeo2CWMhZL4sTJ0qfZ7s5q7rrrOV2+31q8wsd0tTMh7QHl05vW73O755A0W13NjexW+dLx7V8ljdWZUS8uuXHA23fFmMVb4ZssqEdMxRSbenS09frcZqPGUes++JDV77TE70IKOKmqbrnI+14reedF57ICTNb985nq3Lt6tpWvi5brMve0tZS1oiuuOt2mOu/L1ugGAlrMMNZnk5YvMJIH9+WmiZBmsvstr7KuhJjq4tc5ec9ZqP2LrhN8aP9jVP9i9p8kEhemV06hdb5z0pBMH0fme8jgtjuhtRm9kjhtA7vxygOgExvMFjycemruM9e6h5dMB5e26sK93DrSp69PHirmes6bSZvp3DpynPbuvaz5Gwd15Z6zvqCTKxuZ1y3xeCXiEkj18b9LaYSbQ/TZ3q2LyQLtnKZrPQ2AXfnDrcTq83Vi0dd056+riq8bqpq86XajZ2xs6TXXxHzfoABu5f6OHSlzdd852SFnLnsNDgCue9JTAj2OeKRqWddYV6Br1m8+++ejWuaLxITmuo+QZ+191HlXV0dzDqfL86ogiQ+mQ91zzpGdAx6R65vEdN5hmSFjHWRanNbOrCSNs1Lkr/EkaIRXM9XK3VpnbTJ1NvGmDtdOFUeYEahsZU2pXK5JTOLZGGAf0aaOelbp+mOfrfLM90zNXNW/NtvgrQEAzWfdbl9NqO8Kb0yBgd7mvP2qiSCkqdtR3fRfw13mhWB18PO4lbBH//EACMQAAIDAAICAwEBAQEAAAAAAAIDAQQFAAYREhATFSAUFgf/2gAIAQEAAQIAnTLRLg5DcVmS2u5BZxVZTK/SY8THt7+/vE/zHx457S37/PrM+fMzMzJcgbFQ1+AZW30bKnMT+XGMzDZiOzCzjzirSmVgnH6s/Gd1J3T29ebWiPX18eOSEh6+ZP25PJ5MsdOoG4LZxDwxxgyKFK7LTi8GnW3w1fplYUzxG4FGV7AN8fE8dmt6voYHmJ9p5PxMzxrW6h7JbB3fX0nrv4KcuYtGxs2FbSrhYxdcjAVjrRavM0Ctp0Kmu1i5lJ7S+1r7cztdvsk/Mx4mXaZ7RTVxBzOxL4kPrgEQ7Gb12c1Tl2l12hDq+kym7MmnXmu61ybI2BYzjdR9wi5PxMevPdth2oyRrGBMoMm1vp5TUS/X6hMNRXaV9xDu4d0DsU2YrLoVwchaQollu62jCsTYP28ePieSTdNu83SlVUZVUrf4TyK1ZitQYiglifoFkERRLYV1ZnTz6ezH/Nin9QXg7F/2I96Pva+6r7na1J+JmOP227LJFIV4qzVBQWlU629O9GlcJ1mBp3IaGXDYYTfsbIphFaNAxOGfdDSMyIHiQyHiH/oJ0K3YXHAiKQSH0mLQmuwWrKgxbeOLHwfzKXCd7wYn7Nm2v/JnptsTQiZZBscxpGUlE8mOeIGBgYBNFPW1dUnqqunPwc7K7DSUEUsbrC8JKCiOBF2fbyE1M3Jjef8AuUeyXsO9n21e0tYZEUzyeTEj6/XUrY3W6vX89XV4JUp4HLBdRjv3M44nAKeLj64GOaReadL6mafivoT2j/p7DUXbtXyUlPx48eJhFR+bU5S69PW9hyTldmrPFw+Opn/6FzGqEOC0XLOrZbYE73EMdsYLtS0AzxbV6YTv0aesfPJT/McpxdKvwIiN8cqsxWroDqHqMt9ZnvM0l+uBZ+3NtU8wevjQ3EeRnrIdlP7U4+lWWgQ7CHkiiZnzE+fMyM1DunXBlPLodgJ1/Tv1Dy27wZgm3tAo55o2VWcB9DQnYx1b9jkT17m6abCex61yw1OF2Sr5OYmeefPnzwOVpslnWGaZD2RmpATMtL0Rn0c/ttMlxyjmPys3QgJXYsP04+Oqhp9dKsIrRUMrvazKZ+J/oZry8qodiWFzQdsyEsGzXzqtrczD7pKrBF1Riu4tpOxhdYOY+OqBqEsTzm52cnODtrPJT5+PPn4jiJfOXNeZ524LwGiZ9qvYsdVhu3fqj6DwUU+MnfbL42PIcxdKz2dt69oRa+/N0tHTiZ5EePH8DxMunKhEjPceX5OfvsZR5lDN2kQajk+Z2d7havamjne/nzTUWYzBcATLkUxpMCZ+J/mOLJk5UVJ8dyXfiQmKNnkCwYBK4V9eXXhHNEA0x1J5PMqsm0a3rWVCTi0x64nz7eeeRAKAY4YjMimuoXjttl1n/Day6YOmDuPiF8nhc682WG0lalQH/FGZUWWeQvMtIaICFEciMZeMvADCDOip/mhPp6AirWK53Tlw/AXalmAYq6LMuMn8wcukElMTBp/P/8QASBAAAgEDAgMDCAYFCgUFAAAAAQIDAAQREiEFMVETQWEQFCIycYGRoQYjQlJichUgkrHRMDNDc4KTorLB4SQlNERTVGR00vP/2gAIAQEAAz8AtACr8edh3jss19HpRiYxSn73m2Gr6KSOCiTRMftplcVb3C5s+MSuOjYkq+BIE9nKej5ib51fAEtwt2HWJlcVFGSJIZ4vzoRVvKIVinQ6Yt9xzNT9wyPCpV5oaI7qNGiKPkfqaYeQDnke6g/IjyHyny5pu4mn8D8qx62r4ZqM7BsnoBk057tPtoZyTk+Q0fKevkWnBLCPI6itOxBFfiNSoQVc5FcShAVpe1T7sg1irOYjtbZ4G+/A23wNXEgBt+IiVfuyei3zq5lJ7ThdvKPFVB+VW7Hfg8sZ6wzEVkejNexeDoJBVx3S28ng8ToaucnNiG/qZQfkaMfrwXMX54jj4im29NN9xuBU6/0Zp15qRR6UelPI6oiFmJwABmkiK3F+Az81h7h+auFXJJlsISeoXSfitcMf+alni8A2sfOrlf5i7ifwdSlcXh/7XWOsbBquINpoJEP4kIoHkf1egzR7zgdBS/cGKI5MRTj7p+VdVIpT3j9QVHGCZHVR4nFWakjWx8Qpq3c/8Rw5AT9uBjEa4Pdcrh4ye6ePP+JKWYaoNEo6wyB/kcGpEO+seBRs1J3dp7o2qdcHs5z7ImqYSwq0EwAlQkshAwDmmd5ACdZdjpOx3OauIj60i/GroHa4f9o1e91xL+2auogFlCyoO6Qf61Zyqj9vPaMTsNRdT7hXEhGqqba7QuS0jIHwD4CozqzwsN4xFoD8MmoptlTiEPg6rKtSHcPC46NG0Z+WanGCLNyO/QytVnwvduHzxvyLldVcNk2Fyqno21Qy7pKjexqPTy5GDuK4fcfztnC3jpAPyrhcnqdtF+V8j4NVvYqWbi0SdFlT0j7AlP3KCOv+xod4b3ilPeP1RUMYzI6j21bJnQWPsOBT92PhU7eqvxq7l5zEDou1EnJyT5MjWpBUnAIkTFOv/wCkf8amiYED/HH/ABq6NtD2byh0kfUquGYqw8DviuIhiBdTr4M7KfnXFF5zT4/O1XzNpM0vXdj3b1fBQkxWdPuyrrqwuMK8Lwn8B7RP2Xq3uMGJ431ctJ0N+y1SdySfKrheSy/AfxqZWy0Lt1OlaNh/xMpYnfsY/sL4uR31xbcrcTBfwNt8q4qxwbyf9tq4izDtLqYAcwHar6N1dJZMryOompphpmjkU/8AkiOk+8cjUrxNIpguY12JZBke0VbSEl+HRL+KNmjqKCIy+c3VuMeiGkzq9g51xGFj2d2zDpIoar1NpLeF/EZSrY47W0lXxVg1cMWMsiTu/wBzRiuIXWVjdbdOkfr+9jRLFmJZjzJOSfKDQHLI9hoqMl8DxxVvDzkVj0WpJDi3tmY1xW49eRYlqKV2FxcuxADbdDVjEitHbhm54fckUojsZIwAp1r5C1Y8lj2UkP6QhljfBABVSrDkwyaNxlo5IW/KwFXyb6Gx+XPzFXsZ2AyOhwa43AAA8pTox1D55qVjiayhPio7M/4TVpJG8mHQAAHdX9bbAzXDojh+2/ukrhK/al/uR/8AauGIciZxIFKozxYVc8+RNed7wTRv/VsD8jg1eI2N89CCp+dXgONPzridsfqpXTwD7VPL/P28cjnloGlyfalWNrgSFxJj0goWTT4atq4P39t/cr/GuDE7GT+5H8as2T0YnkAOwcCNPfuSamdFaeRIYgNtQwoH4E76gthi1Us4/ppcM3uHIVNOxZ31E95omuoNLQ8grxNEd4pYl1OVUdScUrA9izHxUZHxNTTn05D7zml7VIo01OwzvU1thWdCD9z91MeZpjM6ZOXTHw3NZZQFA2BovwxJs+pcDUPFgRnyZjzQFCuIjlOT7QDXFY+TIf7NcYi5E/2XYVxqHAYO3tIb/MKvU9e2HviQ1H/SW0f91irBzhxgHmNe3wZa4DNzQD8jqK+j024kkHtQH5qa4FJyvkX8yuK4YW9DiEBI/ERTIhCTrJgEKuvKe0864tzUj3Rqa41LJo85SMd7MqjHyp1UY4nMWxuToKt7sVbuuHdf7Ix8txSSZMTKPbtRjbcBsDnz+Aq8ttrbh0wI/pGTU3uA2WrtmZ5lmB5ksG/1rPI5puoFEdPJ4GlqMDJYAeJxVjDkG41HonpV3QwE+L/wFcQm27bQOiDFO51OSx6k5pBC4fOA2dvGsRNpRQdJ3zvyqTMN226ywIoA5qQAKZ8JDAz4kJyefpVeKjYt2UaT3VLb3UZZCBuvxFOHB0EfmP8AoKLcGu09EnCvt3BG8h80Q6abpT9PJmgDuKTfOKj7KQjmFOKglt4JfPrpS8SN3OMkUdivFP24RVyc6bu1f2xkUsE08EujtIn0kpkCiu6zSD2MavF9W7l+Oa4pH6txn2qK43F6s/w1LXH4ebs39smuKp/OQ59y1IPXtv8AB/A1rUKrCLxKs1T917bn86irpxsLNvfV/fgiecun3FOE+ArP2fIBuXx7a1rqRg46g0kTuiwSF1OCGwuDV/JsmmIfhGT8TU05zLI7n8RJ8me6j0piQMUkEgEuezb1seFWqEaIiccif96tYkjlmvyoK4ihXqN81NauI2aJVXBGF3NWMxyZ3U9UORXDZcdrOrjxTeou1bQcL3Zq2NtcRtNH9ZE6c6Y42NQR2kSZJKrvhakl3jhb3/7ZribqG7KNc9xfel60vc1dKzX1T+w0r2VirSKhES/bxyWkDq6zv6BIdO0Az7s0/ngDRSacNuyof3UTxPiB/wDcNR60aNeFL0qMqcgVEelRY2oUvSseqSPYcVcp6txKPY5riA2F3L7zmruO4hndzKY2yFf1T7hXDI7WLtIHMmGzDGgCDJ6mjPPLMcku5O/PyrSZ3oNyxSqdjSTaRqA3ruijkZvEaf31cgQQSRYl161IIIA9tTySOAMumCxz3HpmrhNTCRVzknvzp6e2jHIEa4b18E7AAYyDVqU+slzIV3yxYA95276tX2t9WdRwAM1wJ+G2NwbBC8tujNr61YLDLHDaW6l42UHQO8YpuHcNtUdHZ4IEVhEuokqMbAUXklfQ6anLaXGGXPcRR8uaJjYZq4ks7dYVBcRjBLAYNXwVZOz+uXPNtmDjDew9KnF3JPLAELqQcNn2E9TQ8+v2P/qZP31C9rJK7MHXO43XI61jORy50TyyBRFEUxputHr+ty9g8gok4AJq9ncpDbyO45gDJGK407BfNtBIzhiAcVxMuiPPBGzAkDJOy09ugefiBwXRMRp99gtcO1AS3U7moIOEdrDbSm+VATlhjVnkK41xJDcW9vEEVyhMkoXda4hw25tRdNDr7PWnZEsOdS3zPJJLIGBUHAAzSsSGaQjoWrgc/Dre5ntC8jhslpG7mrgUOnRwu0HiUzVvCsojghUBM+iiigTu+KC8jmsjZTWi9ulx/SeXkKursEooCD12b0VUdWJr6PRX8ENwO2UetO+RHq7gB92vpFA5bhoC2WBoeBFavpOm/wClbjnyJSuNmVEntUvcnkYcP7mSvo9C6TXMfYC9XBjd8FJG3ytQ2gbMOpNTEMuQSV5g9GHeDQttEkcplhnGpH69QaFbY8mfKaJo0a2qCSOzZ0JMr4b0sd+K4Td2jyPbSPKruvrkLVrBcK01tbaMHCE/xqFOP36KiBVtGC4AwMOaU3PFjok1i4GG07YZBkE0GlEhRi4UqD4MQTT9qXZc4GE9HdQee/jRB5VlgM99ZtHPZsOXpHfvq58yuMyR9kt5MCoQ5zWL7h562rfJ6J7f2rW5Nf8AJbXwZx/ioaBnPM1ntducZp/CjTcg1Fb648Sp+Q8l1fSBIIyxrh3C0bt2F1OP6GI+iD0eT+FXfEEjEoWOIbpCg0oPJf2ZzbXcsR/CxrjIcI0kch55eFGrjeGVLoQ+ESKlXF9dWouJXmftVUazk7tRuLmeyli1zqFIXP8A1CAfKVO41PwvtIUlL2dw3aI2PWx+4jvFeNL/ACDSkYFPHC7kgYFDsOG+Mh/z1ZvBlp7wjUfRE2lflXB+ZtnJ6vKzGrmw47LDYzGBPQiGnc6S1XpvOJCG/ubdRcbrD37VcP8AznFeJt/a/wB6WGOCdL28dvOooysr9zUCFIORgUA4J6ipPNH3KgMcjJ3AaitpxEdL+Ss3PDG6wS/J6FybgtPHCqKGJY7nwUbZNQIcJOj6QTpZgWc9MR5wPfUP6GiKhVCzOGAXocnG5qCVMpIB6WMNtvil7YxZyxjf3YFJPDqYBWDaWXPI1BbhTISNXv5UHUFCGBGQae3uXR5mmbYl5MFv8OBUaSo0kZdA2WQHTkdM1czoYIgltb/+OLbP5m5tUMd06G084MkLIqAqDliBn064DaXL8Le3uoREy5MGgBiRnJZ8tX0eaAy6OKaNejUZ4vWr6NhGLTcUGBk/WwmvozLakrFxIhWCFwIjJk19GYSiPb3r9mcEtFCWJHU19HWlglC351jtkQrFggmuHW9pa3th9Q06owjPr4zzqx4tZzWPFmEcrDKXP4xyZ+jUFJAIOO8fyGTWAPSrNrKPCsW/DP6w/wCeiYowskak5OGOMgVNk4WBl2AKsWOKQ/SgAYKmeH5tRuL7jPp6cTp9nPMVbWRSa6ukWMMOac/Dare67NIpta+dQlRpAxiuHo3oogYHfBNRF10xqM4JbODSNbXEQkyCzFRjuLZFJAOKa53OL1vQJ2NQTS8MzJowkoGxbOWFYeZTp2wDlhzBpI3yvpsSfBRQteHyq/paHl14XnVp5vK51ovbjYb+kykd9Wkl1DBG0jSLHLu4HI9xxVrxB7hYpmDRPhsnqSdqQOHeRZMIR6Tn41bRsoW9U+hlQJjTWl4iEnJhVjvnc+VJuM2ep8aJA4B+0R3UT9IuJeE+n4KKiPDUiK6QL5m680FKwgYMyogyY8Ahsj7VW1rFII4gEVwpySDqO+woyt66xR98khIQfx9goXEdssSiRI4OzUsu74JOcd1OllwTKsNNhEPAEkmj5d/1soPA71igbeT2VI1twwqjt9Y/IZ5PU9zNbSqmY4+ZyBsw3qa1nadkUQNAwLZGnBFFOMMyDQQUIHQg0bHiHEAs8kTyn0WAyAwUYLVe3yW0c1x2qqSScYorNECBvcL8FIovxm9yPUeXu6vStdW+psfUn99BbxQOq/vp4L+4kXml0W+BzSxXaAZ2kkYflbDCsXl4Pxn99DNdhHdDtiv/ABLDZNQ361JLBIkRgm1b82RiVBAoxcTSCWApK7t6xIPqEgAGo+HTTwRxqzS3MjZ3GTmpsFTbZ2I9fFRy2ELywp2u4b7WMd2a4fPf4SZC0aCN9m2YE7eV24nbKjYPnEHyai/HeKOAWxeuMDwNYs537FSEfIfWQSTjbFcKRV1SvkIM/VmnmlcjaGZmZTncqDtV1xA2ETQqJRCEQhdOtANiTTywiR7qNcgkDSTQgXhTByTHw62hAx4Fs+Xb+QFfUv7DQtuG8PlIyA9wv7ZC1HYxRQkIWKassQqgeJNXE8Ub7R2yKCI0woYf2qL8ReXfJUGlN9cEkZymAc75UUrRqSOW3OoleJVUBtakfEZrhthNc3QTQrzsruMtk6qseLQQXIYsmCEYAgmrWHXIGfKjK5q3u7/iyyNINEykaT1FW58ykaRk2deuQgFCO9kKtkSIJPifIvFTPMLySJEn3QKDk881d5draZZPtIrHQy+Ablg1xJJAlxGY5Yj6OoBiMgjY7irQ8WMkiXHaSlnYppKAk7tpIrKjSEIIBB0g0nD7NWvrsQWpbZlJDsT9gKorgcrIUurvCrj00l8sb8ZtC8gUrcRkL3timXz7iUl5EiB3nzEjK+5rhKwSBGncbt6p54oOFLSLGFzkkE/Ic6W9fC3qBVB2aJsgf2c0guYOxW4mMQdgCgBYMMbCuIyRsyWM+gbbBQKmF3ZIyEItla7k/a0bit65/wAhuK2FfVN7KMnB7FVGT2s/yYGuJACWygZvQV+1TUZOhQAVxQoGe7kRy+kpL6De0hqMsVvK76maFizHqGphePiQJlE/y0MAKwOAN8ggmt1Y5ypGNiK8/imiEienL2uxyQWOogiprCxt7ZXBKA79cnNJZX0NgVM0khRX07BA/ImkTi/GEzuxjIHuom3sdyB2so+QpJnXWpBSEIMEDkaHJaC2vEC2yq6sT4BTTvdKHskW0LgFtX1gU/aIoSus+gscDk/cKge4S4MM3aICFKsdtXPdSKKqBL2oCjuXQoFRXktq8l12iW7MyLoAxqGOdREnQ0qjJ5Fe857wfK/6TgmC5RJcMcE4yhpE4c6yIjI7JGVfJB1GoFvbmTWIo0ZUEATZV5O2GPrdK4Q1zbWlol7dxSuWmclQ6eKFTp/arh8GWbh91odBHKUmHqLsMaQcP1NWMrrO3Dz2vqtI7silFONIBAAbA51bOksLcMWeYO77M0mmNjhRlSBVw11bme1eEkZTIwpVF09TX7628m/8h6DV/wAu4f8A1l1WYIj+AVrGG3HjSJxRlVQAE/hWq+mG2DFF/lpBzjGK7NyBgqS+Nz3VcTX1/FCgVLYlQz7g+A2qdYGAsnfsYy7kuq7Ck4lfzXt5MVIkWQeLsdqFnxe+mEBf1M4wMZXOaXiMFuiqPQkZtm1cxWJD6PcadjsKvYrO6hiwol0at9yBzAqxk4CMRATjcyfiLY0moYreCDzxJnRApckKSR4UkW7ui+0gUqcHuXV9iUUspzjJ57VxmEA210s68iNm+TVxlNns9/6ryIWAeQIvexrgHDgz+a3t3ciXKsqbIByxSX8PYt9G+ITpkNhlIGRTNGVi+iJiPc7OFYe9hUrLomg7A8tCyhtvatOhCRTSpFzIDbmoJCXneWVV9QM37zXmKPIty8BdioaNC5K88bEVc31yVkvbiaJd0WUFcEjfCkn9Qfr7VlG9lE8Osv6+5omCHB+wKascUPjGKBvGycfURH27UoRmOWwvLNQMD6DZAYgHxHUUz3EtxHO6mUhiAxAyQKmwweR2BBBOdyDRspgYpiAcArImoY92CDQueJXMQmjjfSjAMcavRIwK/CB7cmmEgxge6nbGSxp+rY796sxHbXWqRmID4LeiGpehpkOQzfE05tuxunka3mbS+ACV76h0CaxmyBzIBTB6MMnAPWuKrsDL8jWK5Z5ZriplulsvPdmAfzfIG3LURXGpmCyJdFj3SXKgn3E1cREC4W1jY90tzlvgtJZl7YpAxTILxkkAnoTUOFDKQSd2G5IqySTAtgQPsMSQfE12qKZrVzIxd9HnAtsL1II5VHccX81DpCrOq5V/OACR97vrsZpYs57OR0z10nGf5PKH2Vmwshk4M04O/hWbaL8o8jniOoIxHZCibsf/AB4qcg45Yo6sY6/uoNNfQE7pIjD2OimlPI0DjODSHi17rGxsgT86YjYHHjREi5xW2DvQGQeWeVTtw22eMgrhhgnHI1KB6fwApQcGlexnITUUXWBnvWpI/STn0pmGTZK3iBnytdrcyHhs136a7rL2aLtyNNCl3aWNpb2Mg2mlknXI8EardZVmlvrKPMRUNAzMPHURqYsaiiaR4rtZV5gCFwD8RV2DqjXmOZQf61xO2cXaWcUwiBK5XYH73o9KuXnma7t7Z7qUaiLh8IFB9oFPHezMnYqwfY2/qD8hyalgnmjmBEquQ+dzq76Hfn3fqjrUj+rG7exSav35WkvvXFcQbnGq/mcVc/amhX3k0VQ6rjPgqUsFtbxaiDFJI3pbZDih2EY8AKXPrGp7XiyGGUrmEew4FW7XIS4tQ2YEbWhw2/dVlcf9NdhW7klGk1xCHdodS9QAx+IqwCNKUYSuqCRiDklUHKolI7LtN2A3wOdSDvpIuKTA7l7AgDr61YABFemtCjg4qX9FoAAdMsgqUD1FB8TQbZjF++omGQqn2d9KLmRoY9Kk+qMVeRKESWRQO4Z8vD8MlzbzzSs4CBGVV9+qof0kvD7exQsJVUrI+3LJBK42FWcTsVhQAqocjOCw71BORTRykxqWDjIOqr8kxiBg/rDMgP8ArQs5FFz2eY43Y6QTjp860uylVGk4OOopjyG9X9wDJozk7szjNXROGeNfiaxjXc/BKtz/AEkrfAVAeVszfmkqNf8AtoB7d6VNgYx+VAKH/kkPswKjHMMfaaReUYo9wok8qV9mQGpYo8wSaD90+kh9xrsGjS7i7PUfRZTrRv8AUUfP4Hxt2VBZ4GbYG0irWR34FXVqrdlMy4Gw5j4Gu3t45XRdTgE4FRyDvXcVKjAEKcjaj+lE7tdiR/iqZmOn5mrwMpGg++psek6D4mo+Rlcn2AUtnAYkL4LlufeaDV4UelRv6yA1C2+G+Nf/xAAqEQACAgEDBAEDBAMAAAAAAAAAAQIRIQMQEiAxQVFhEyIjQ1JxkVOB0f/aAAgBAgEBPwC2WzBSKMosssbSOZyXVZfRkowYK+drMbNI4nFnGQk+j+WWhdlvRxKfTaLW1dFMl9qsUpO78E4ybILBHemJEnTWaLa7SsW3+ik/BwRwRxJKSqiltZPMWQUm22jg3lMUGu7FGj6dvFsc5Jtensxq2mhpO3WRwnOlCajQrr5XUrY00JexQj5JKnS9HFJJ2RiuI6PIxrL2fehsb70mxamKUaEqx0VtJtdk2Qm28waIakEknptsk5eIMmtRu+DSQm/2uhdh61SZ9a8pXYtWT8It7LGqn8GHLsYTYlTXXFVJMeWmyLuNeRYaJv7JfwS4/QVN3RHMT6enJZiS045jG/ijS5W+R+Pabacmac8O36LtJ+xNOVdVYJdkRuyKVJ2f9JTTjxh5Rf4mmQ7Em0qGppvMkaEIqLlPk/Bej/ils9OLebFCMey2pXdZ6VtWFZSTTIxfETuxqiXGl7Idh5Gj7UqpHB/tl/T3vps5ITRyFyJVRG3BJSeCHKMni8CcZ4vPocZVH0RToinY38ElyOeqv1Z/2f/EACwRAQACAQIEBAQHAAAAAAAAAAEAEQIQEgMgITETIkFhMlFxkTAzQERQUqH/2gAIAQMBAT8A/hwXsXERp/R4Y7sqjjhjto7zDM21OPXiKc59OS5cvTh+Hle/oU1pemDWZM3ACm5vxuntMsh+G4SvKtyuQsrrMMuHgZb8VuPd+XM6V7y4VtfLqcxpWPqvyi3ykC/UJtf7DMuHxFs4lECjzZjMcsKoyGO2umQ6bek2+8qddEdsbAqehF6c71GAETISdxmPxEPzI9455nZmK0KVM8aO866Yhk4gLOLgYp0ptK+k4ZvauusRrnwmQR0MW1ylAiX7xh1mLhReGM4+fUMQP9nhL+54f2dDJI5Lp6VzneN1FOkumWMIw0bW90v3Pw61WmKQ3EHGvW46krD5H2n/2Q==" width="170" alt="LyneSign screen displaying local weather inside a Houston laundromat." style="display:block;width:100%;max-width:170px;border-radius:8px;">
                  </td>
                </tr>
                <tr>
                  <td class="mosaic-cell" width="33.33%" valign="top" style="padding:0 4px 0 0;">
                    <img src="data:image/jpeg;base64,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" width="170" alt="LyneSign screen displaying local weather and ads inside a Houston convenience store." style="display:block;width:100%;max-width:170px;border-radius:8px;">
                  </td>
                  <td class="mosaic-cell" width="33.33%" valign="top" style="padding:0 4px 0 4px;">
                    <img src="data:image/jpeg;base64,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" width="170" alt="LyneSign screen inside Sweet Spot Cafe, a Houston candy and dessert shop." style="display:block;width:100%;max-width:170px;border-radius:8px;">
                  </td>
                  <td class="mosaic-cell" width="33.33%" valign="top" style="padding:0 0 0 4px;">
                    <img src="data:image/jpeg;base64,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" width="170" alt="LyneSign screens inside a Blink Fitness gym, above rows of treadmills." style="display:block;width:100%;max-width:170px;border-radius:8px;">
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- 5. CTA band -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:32px 40px;background-color:#062A43;">
              <p style="margin:0 0 4px 0;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#DDA974;">
                Ready When You Are
              </p>
              <p style="margin:0 0 20px 0;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:20px;font-weight:700;color:#FFFFFF;">
                Put your brand on screens across Houston
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td align="center" style="background-color:#DDA974;border-radius:8px;">
                    <a href="https://lynesign.com/landing/#final-cta" target="_blank" style="display:inline-block;padding:14px 36px;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:14px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:8px;">
                      Start Today
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- 6. Sign-off -->
          <tr>
            <td class="mobile-pad" style="padding:24px 40px 40px 40px;background-color:#FFFFFF;">
              <p style="margin:0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.6;color:#666666;">
                Thank you,<br>
                The LyneSign Team
              </p>
            </td>
          </tr>

          <!-- 7. Contact band -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:32px 40px;background-color:#F4F4F4;">
              <p style="margin:0 0 8px 0;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:16px;font-weight:700;color:#062A43;">
                Get in touch
              </p>
              <p style="margin:0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;">
                <a href="mailto:contact@lynesign.com" style="color:#062A43;text-decoration:underline;">contact@lynesign.com</a>
              </p>
            </td>
          </tr>

          <!-- 8. Social icons row -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:24px 40px;background-color:#FFFFFF;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 6px;">
                    <a href="https://www.facebook.com/LyneSign" target="_blank" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:#1877F2;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.facebook}" width="18" height="18" alt="Facebook" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                  </td>
                  <td style="padding:0 6px;">
                    <a href="https://www.linkedin.com/company/lynesign/" target="_blank" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:#0A66C2;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.linkedin}" width="18" height="18" alt="LinkedIn" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                  </td>
                  <td style="padding:0 6px;">
                    <a href="https://www.instagram.com/lynesign/" target="_blank" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:#E4405F;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.instagram}" width="18" height="18" alt="Instagram" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                  </td>
                  <td style="padding:0 6px;">
                    <a href="https://www.youtube.com/@LyneSignLLC" target="_blank" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:#FF0000;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.youtube}" width="18" height="18" alt="YouTube" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- 9. Footer bar -->
          <tr>
            <td align="center" style="padding:20px 40px;background-color:#062A43;">
              <p style="margin:0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:12px;line-height:1.6;color:#C7CDD9;">
                &copy; 2026 LyneSign. All rights reserved.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`,
  },
  {
    // A short, single-focus pitch template built around two real venue
    // photos already hosted under public/mosaic-*.jpg (extracted from
    // lynesign.com/landing/ and proxy-exempted for the Houston intro
    // template above, reused here rather than sourcing new images). Where
    // the intro template above educates, this one is a direct ask, one
    // headline, one hero photo, one CTA, matching the shorter cold-outreach
    // format real advertisers respond to on a first touch.
    key: "business_lynesign_advertise_here",
    categoryKey: "business_general",
    sortOrder: 7,
    name: "Advertise Here — Where Your Customers Are",
    subject: "Advertise Here, Where Your Customers Are",
    bodyFormat: "HTML" as const,
    body: `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>LyneSign</title>
<style>
  body, table, td { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
  body { margin: 0; padding: 0; width: 100% !important; background-color: #F4F4F4; }

  @media only screen and (max-width: 600px) {
    .email-container { width: 100% !important; max-width: 100% !important; }
    .mobile-pad { padding-left: 24px !important; padding-right: 24px !important; }
    .hero-heading { font-size: 26px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F4;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F4F4F4;">
    Your ad, playing on a real screen inside the local businesses your customers already visit.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F4F4;">
    <tr>
      <td align="center" style="padding:24px 16px;">

        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:600px;max-width:600px;background-color:#FFFFFF;">

          <!-- 1. Header -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:32px 40px 24px 40px;background-color:#FFFFFF;">
              <img src="${LOGO_URL}" width="160" alt="LyneSign" style="display:block;border:0;width:160px;max-width:100%;">
            </td>
          </tr>

          <!-- 2. Hero photo -->
          <tr>
            <td align="center" style="background-color:#FFFFFF;">
              <img src="${APP_BASE_URL}/mosaic-blink-fitness.jpg" width="600" alt="A real LyneSign screen playing inside a busy Houston gym" style="display:block;width:100%;max-width:600px;">
            </td>
          </tr>

          <!-- 3. Headline band -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:36px 40px;background-color:#062A43;">
              <p style="margin:0 0 10px 0;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#DDA974;">
                Indoor Digital Billboard Network
              </p>
              <h1 class="hero-heading" style="margin:0;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:30px;line-height:1.25;font-weight:700;color:#FFFFFF;">
                Advertise Here, Where Your Customers Are
              </h1>
            </td>
          </tr>

          <!-- 4. Body -->
          <tr>
            <td class="mobile-pad" style="padding:40px 40px 8px 40px;background-color:#FFFFFF;">
              <p style="margin:0 0 16px 0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.6;color:#666666;">
                Hi {{first_name}},
              </p>
              <p style="margin:0 0 16px 0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.6;color:#666666;">
                This is a real LyneSign screen, playing inside a real Houston business right now. Your customers are already spending time in local shops, restaurants, and gyms just like this one, with minutes to see and remember your message instead of a few seconds glancing out a car window.
              </p>
              <p style="margin:0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.6;color:#666666;">
                One of these screens could be playing your ad this month.
              </p>
            </td>
          </tr>

          <!-- 5. Second real photo -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:8px 40px 8px 40px;background-color:#FFFFFF;">
              <img src="${APP_BASE_URL}/mosaic-convenience-store.jpg" width="520" alt="A real LyneSign screen playing inside a Houston convenience store" style="display:block;width:100%;max-width:520px;border-radius:12px;">
            </td>
          </tr>

          <!-- 6. CTA band -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:32px 40px;background-color:#062A43;">
              <p style="margin:0 0 20px 0;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:18px;font-weight:700;color:#FFFFFF;">
                Ready to put your brand on screens across Houston?
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td align="center" style="background-color:#DDA974;border-radius:8px;">
                    <a href="https://lynesign.com/landing/#final-cta" target="_blank" style="display:inline-block;padding:14px 36px;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:14px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:8px;">
                      Start Today
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- 7. Sign-off -->
          <tr>
            <td class="mobile-pad" style="padding:24px 40px 40px 40px;background-color:#FFFFFF;">
              <p style="margin:0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:15px;line-height:1.6;color:#666666;">
                Thank you,<br>
                The LyneSign Team
              </p>
            </td>
          </tr>

          <!-- 8. Contact band -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:32px 40px;background-color:#F4F4F4;">
              <p style="margin:0 0 8px 0;font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:16px;font-weight:700;color:#062A43;">
                Get in touch
              </p>
              <p style="margin:0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:14px;line-height:1.6;">
                <a href="mailto:contact@lynesign.com" style="color:#062A43;text-decoration:underline;">contact@lynesign.com</a>
              </p>
            </td>
          </tr>

          <!-- 9. Social icons row -->
          <tr>
            <td align="center" class="mobile-pad" style="padding:24px 40px;background-color:#FFFFFF;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 6px;">
                    <a href="https://www.facebook.com/LyneSign" target="_blank" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:#1877F2;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.facebook}" width="18" height="18" alt="Facebook" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                  </td>
                  <td style="padding:0 6px;">
                    <a href="https://www.linkedin.com/company/lynesign/" target="_blank" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:#0A66C2;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.linkedin}" width="18" height="18" alt="LinkedIn" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                  </td>
                  <td style="padding:0 6px;">
                    <a href="https://www.instagram.com/lynesign/" target="_blank" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:#E4405F;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.instagram}" width="18" height="18" alt="Instagram" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                  </td>
                  <td style="padding:0 6px;">
                    <a href="https://www.youtube.com/@LyneSignLLC" target="_blank" style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:#FF0000;text-decoration:none;"><img src="${SOCIAL_ICON_URLS.youtube}" width="18" height="18" alt="YouTube" style="display:block;width:18px;height:18px;margin:7px auto 0 auto;border:0" /></a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- 10. Footer bar -->
          <tr>
            <td align="center" style="padding:20px 40px;background-color:#062A43;">
              <p style="margin:0;font-family:Montserrat, Helvetica, Arial, sans-serif;font-size:12px;line-height:1.6;color:#C7CDD9;">
                &copy; 2026 LyneSign. All rights reserved.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`,
  },
];

async function main() {
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { key: plan.key },
      create: plan,
      update: plan,
    });
    console.log(`Seeded plan: ${plan.key}${plan.stripePriceId ? "" : " (no Stripe price set yet)"}`);
  }

  const categoryIds = new Map<string, string>();
  for (const category of TEMPLATE_CATEGORIES) {
    const row = await prisma.templateCategory.upsert({
      where: { key: category.key },
      create: category,
      update: { label: category.label, sortOrder: category.sortOrder },
    });
    categoryIds.set(category.key, row.id);
  }
  console.log(`Seeded ${TEMPLATE_CATEGORIES.length} template categories`);

  for (const template of STARTER_TEMPLATES) {
    const { categoryKey, key, ...rest } = template;
    const data = { ...rest, key, categoryId: categoryIds.get(categoryKey) };
    await prisma.starterTemplate.upsert({
      where: { key },
      create: data,
      update: data,
    });
  }
  console.log(`Seeded ${STARTER_TEMPLATES.length} starter templates`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
