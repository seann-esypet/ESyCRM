import type { InsertEmailSequence } from "@shared/schema";

export const DIRECTORY_FIRST_STRATEGY = "directory_first";

export const DIRECTORY_TRACKS = [
  "directory_general",
  "directory_has_software",
  "directory_no_software",
] as const;

const signature = `[Sales_Person]
EsyPet  |  Scheduling Software Built by a Groomer
<a href="https://software.esypet.com/">Visit EsyPet</a>
1-888-6-ESYPET`;

export const directoryEmailSequenceTemplates: InsertEmailSequence[] = [
  {
    strategy: DIRECTORY_FIRST_STRATEGY, sequenceTrack: "directory_general", sequenceNumber: 1,
    subject: "[Contact_First_Name], are you listed on EsyPet's free grooming directory?",
    body: `Hi [Contact_First_Name],

I'm [Sales_Person] with EsyPet. We just launched a free pet grooming directory at esypet.net — and I wanted to make sure [Business_Name] has a listing before pet parents in [City] start finding your competitors instead.

No cost. No software switch. Pet parents find you, book directly, and you get the referral. We handle the SEO.

Takes about two minutes to get listed:

<a href="https://signup.esypet.net/?plan=95625be6-a031-4015-afb7-ba0fdd3f5798">Get Listed Free</a>

Happy to answer any questions — just reply here.

${signature}`, scheduledDate: null, scheduledTime: "09:00", daysAfterNoReply: null, isActive: "true",
  },
  {
    strategy: DIRECTORY_FIRST_STRATEGY, sequenceTrack: "directory_general", sequenceNumber: 2,
    subject: "[Contact_First_Name], quick follow-up on the EsyPet directory",
    body: `Hi [Contact_First_Name],

Just checking in from last week. Wanted to make sure this didn't get buried.

Your free listing on esypet.net gets [Business_Name]:

•  Found by new pet parents searching locally
•  Direct appointment referrals — no middleman fee
•  SEO handled by us, not you
•  Appointment confirmations and SMS notifications included
•  No software switch needed

If you do get curious about what our full scheduling software looks like — groomers typically say it's the first one that was actually built by a groomer — this video is 3 minutes:

<a href="https://esy.pet/Salon-SignUp">&#9654; Video: Getting Set Up</a>

Either way, the directory listing is yours for free.

<a href="https://signup.esypet.net/?plan=95625be6-a031-4015-afb7-ba0fdd3f5798">Get Listed Free</a>

${signature}`, scheduledDate: null, scheduledTime: null, daysAfterNoReply: 7, isActive: "true",
  },
  {
    strategy: DIRECTORY_FIRST_STRATEGY, sequenceTrack: "directory_general", sequenceNumber: 3,
    subject: "[Contact_First_Name], no commitment — not even a monthly fee",
    body: `Hi [Contact_First_Name],

One more thing I want to mention in case the idea of a monthly subscription ever felt like a reason to hold back:

EsyPet has a pay-per-appointment option. No monthly fee — just $2 or $3 per completed appointment, depending on the features you need. If you have a slow month, you pay for a slow month.

The free directory listing is still completely separate — that's yours no matter what. But if you've ever thought about trying full scheduling software without committing to a monthly bill, this is how.

We also offer a 2-month free trial — twice as long as any competitor I know of — so you can actually see if it works before spending anything.

<a href="https://software.esypet.com/pricing/">See Full Pricing</a>

<a href="https://signup.esypet.net/?plan=95625be6-a031-4015-afb7-ba0fdd3f5798">Get Listed Free</a>

${signature}`, scheduledDate: null, scheduledTime: null, daysAfterNoReply: 7, isActive: "true",
  },
  {
    strategy: DIRECTORY_FIRST_STRATEGY, sequenceTrack: "directory_general", sequenceNumber: 4,
    subject: "[Contact_First_Name], last note from me — this is yours any time",
    body: `Hi [Contact_First_Name],

Last email from me for a while — I don't want to be that person in your inbox.

I'll leave you with the short version:

Free directory listing at esypet.net — get found by new pet parents, no software switch, no cost.

Pay-per-appointment option if you ever want to try full scheduling software without a monthly commitment.

2-month free trial — no credit card required.

Software built by a groomer with 20+ years on the floor.

The four demo videos are here if you ever get curious:

<a href="https://esy.pet/Salon-SignUp">&#9654; Video: Getting Set Up</a>
<a href="https://esy.pet/Lib_Dir_temp">&#9654; Video: Customization</a>
<a href="https://esy.pet/Reg_Settings">&#9654; Video: Pet Parent Registration</a>
<a href="https://esy.pet/Cal_Apps">&#9654; Video: Apps &amp; Wellness Check</a>

And the free listing signup is always here:

<a href="https://signup.esypet.net/?plan=95625be6-a031-4015-afb7-ba0fdd3f5798">Get Listed Free</a>

Wishing [Business_Name] a full schedule and happy dogs. 🐾

${signature}`, scheduledDate: null, scheduledTime: null, daysAfterNoReply: 7, isActive: "true",
  },
  {
    strategy: DIRECTORY_FIRST_STRATEGY, sequenceTrack: "directory_has_software", sequenceNumber: 1,
    subject: "[Contact_First_Name], even if you love your current software — don't miss this",
    body: `Hi [Contact_First_Name],

I'm [Sales_Person] with EsyPet. I can see [Business_Name] is already using grooming software — so I'm not here to pitch a switch.

But I did want to make sure you know about esypet.net — our free directory for pet parents looking for local groomers. You can get listed at no cost, no software change required. Pet parents find you and book directly.

Takes two minutes:

<a href="https://signup.esypet.net/?plan=95625be6-a031-4015-afb7-ba0fdd3f5798">Get Listed Free</a>

New clients from a free listing — worth two minutes?

${signature}`, scheduledDate: null, scheduledTime: "09:00", daysAfterNoReply: null, isActive: "true",
  },
  {
    strategy: DIRECTORY_FIRST_STRATEGY, sequenceTrack: "directory_has_software", sequenceNumber: 2,
    subject: "[Contact_First_Name], what the EsyPet directory actually gives you (free)",
    body: `Hi [Contact_First_Name],

Following up from last week — wanted to be specific about what the free listing includes, because 'free directory' can mean a lot of things.

For [Business_Name], the free listing includes:

•  A profile on esypet.net that pet parents in your area can find and book from
•  Appointment referrals go straight to you — we don't take a cut
•  500 SMS/month for appointment confirmations and notifications
•  Appointments sync to Google or Outlook Calendar
•  SEO managed by us
•  No listing fee, no monthly charge

Your current software handles the appointments you already have. The directory brings in new ones. They're not in conflict.

<a href="https://signup.esypet.net/?plan=95625be6-a031-4015-afb7-ba0fdd3f5798">Get Listed Free</a>

<a href="https://software.esypet.com/free-network-explained/">How the Free Listing Works</a>

${signature}`, scheduledDate: null, scheduledTime: null, daysAfterNoReply: 7, isActive: "true",
  },
  {
    strategy: DIRECTORY_FIRST_STRATEGY, sequenceTrack: "directory_has_software", sequenceNumber: 3,
    subject: "[Contact_First_Name], a question about your current scheduling setup",
    body: `Hi [Contact_First_Name],

One genuine question before I give you some space:

Does your current software let you set individual booking rules for each groomer — breed size limits, specific breed blocks, cat-only time windows — enforced automatically even during online booking?

I ask because it's the thing grooming salon owners tell me most other platforms don't do well. If yours handles it, great. If it doesn't — or if you've ever had a giant breed land in the wrong slot — it might be worth a 10-minute look at how EsyPet approaches it.

No pressure either way. The free directory listing stands regardless.

<a href="https://esy.pet/Lib_Dir_temp">&#9654; Video: Customization</a>

<a href="https://signup.esypet.net/?plan=95625be6-a031-4015-afb7-ba0fdd3f5798">Get Listed Free</a>

${signature}`, scheduledDate: null, scheduledTime: null, daysAfterNoReply: 7, isActive: "true",
  },
  {
    strategy: DIRECTORY_FIRST_STRATEGY, sequenceTrack: "directory_has_software", sequenceNumber: 4,
    subject: "[Contact_First_Name], last note — the listing is yours whenever you want it",
    body: `Hi [Contact_First_Name],

Last one from me for a while.

I know switching software is a real decision — contracts, data migration, retraining staff. I'm not asking for any of that today.

But the free directory listing at esypet.net is there whenever you want it. New pet parents looking for local groomers. No cost, no commitment, no conflict with what you're already running.

And if you ever get curious about EsyPet's scheduling software — 2 months free, no credit card — or our pay-per-appointment option — it's all here:

<a href="https://software.esypet.com/pricing/">See Full Pricing</a>

<a href="https://signup.esypet.net/?plan=95625be6-a031-4015-afb7-ba0fdd3f5798">Get Listed Free</a>

Wishing [Business_Name] full books and happy dogs. 🐾

${signature}`, scheduledDate: null, scheduledTime: null, daysAfterNoReply: 7, isActive: "true",
  },
  {
    strategy: DIRECTORY_FIRST_STRATEGY, sequenceTrack: "directory_no_software", sequenceNumber: 1,
    subject: "[Contact_First_Name], free listing for [Business_Name] on a pet grooming directory — no software needed",
    body: `Hi [Contact_First_Name],

I'm [Sales_Person] with EsyPet. We run a pet grooming directory at esypet.net where pet parents find and book local groomers — and I wanted to make sure [Business_Name] is listed before someone nearby gets a head start.

It's free. No software to learn. No card on file. Pet parents find your listing, and you get the referral.

<a href="https://signup.esypet.net/?plan=95625be6-a031-4015-afb7-ba0fdd3f5798">Get Listed Free</a>

Takes two minutes. Worth it?

${signature}`, scheduledDate: null, scheduledTime: "09:00", daysAfterNoReply: null, isActive: "true",
  },
  {
    strategy: DIRECTORY_FIRST_STRATEGY, sequenceTrack: "directory_no_software", sequenceNumber: 2,
    subject: "[Contact_First_Name], what if you only paid when a dog came through the door?",
    body: `Hi [Contact_First_Name],

Following up from last week — and I want to share something that I think removes the biggest hesitation most grooming salons have about scheduling software:

EsyPet has a pay-per-appointment option. No monthly subscription. Just $2 per appointment for a solo groomer, or $3 for a full salon setup with multiple groomers. Slow month? You pay for a slow month.

This is on top of the free directory listing — which is separate and yours at no charge regardless.

If you've ever thought about trying software but the monthly commitment felt like a risk — this is how you try it without that risk. And there's a 2-month free trial to start.

<a href="https://software.esypet.com/pricing/">See Full Pricing</a>

<a href="https://esy.pet/Salon-SignUp">&#9654; Video: Getting Set Up</a>

${signature}`, scheduledDate: null, scheduledTime: null, daysAfterNoReply: 7, isActive: "true",
  },
  {
    strategy: DIRECTORY_FIRST_STRATEGY, sequenceTrack: "directory_no_software", sequenceNumber: 3,
    subject: "[Contact_First_Name], I built this software because I had the same problem you have",
    body: `Hi [Contact_First_Name],

I groomed for over 20 years. Owned multiple shops. And the thing that drove me crazy — the thing I never found a software fix for — was managing what got booked into each groomer's day.

One giant breed in the wrong slot could wreck an afternoon. I managed it all in my head because nothing would hold the rules for me. So I built EsyPet — and gave every groomer their own scheduling template with rules the system enforces automatically, even during online booking.

This 3-minute video shows what I mean better than I can describe it:

<a href="https://esy.pet/Lib_Dir_temp">&#9654; Video: Customization</a>

2-month free trial. No credit card. And the free directory listing is already waiting for you.

<a href="https://signup.esypet.net/?plan=95625be6-a031-4015-afb7-ba0fdd3f5798">Get Listed Free</a>

${signature}`, scheduledDate: null, scheduledTime: null, daysAfterNoReply: 7, isActive: "true",
  },
  {
    strategy: DIRECTORY_FIRST_STRATEGY, sequenceTrack: "directory_no_software", sequenceNumber: 4,
    subject: "[Contact_First_Name], last note — no pressure, just options",
    body: `Hi [Contact_First_Name],

Last email from me for a while.

I'll leave you with three ways [Business_Name] can work with EsyPet — starting at free:

Free: Get listed on esypet.net. New clients find you. No software, no cost.

Pay-per-appointment: $2–$3/appt. Full scheduling software, no monthly commitment. 2-month free trial.

Monthly subscription: $79–$229/mo. Full platform with unlimited features and 24/7 support.

The videos are here whenever you're ready:

<a href="https://esy.pet/Salon-SignUp">&#9654; Video: Getting Set Up</a>
<a href="https://esy.pet/Lib_Dir_temp">&#9654; Video: Customization</a>
<a href="https://esy.pet/Reg_Settings">&#9654; Video: Pet Parent Registration</a>
<a href="https://esy.pet/Cal_Apps">&#9654; Video: Apps &amp; Wellness Check</a>

Wishing you full books and happy dogs. 🐾

${signature}`, scheduledDate: null, scheduledTime: null, daysAfterNoReply: 7, isActive: "true",
  },
];