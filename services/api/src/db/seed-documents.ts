/**
 * The demo club's document hub.
 *
 * Text documents only. There is deliberately no seeded *file* document: seeding
 * one would mean either committing a binary fixture to the repo or writing to
 * object storage from the seed, and a seed that fails when MinIO is not running
 * would make the database seed depend on a service the database does not need.
 * Uploading a PDF by hand is the way to see that path.
 *
 * Every section gets at least one document, including a draft, so the hub shows
 * its real shape - sections, a published/draft distinction, and a document with
 * history - rather than a single row that makes the page look finished when it
 * is not.
 */

export interface DocumentSeed {
  /** Stable id so re-seeding updates a row rather than duplicating it. */
  id: string;
  section: 'rules' | 'onboarding' | 'meeting_notes' | 'forms' | 'other';
  title: string;
  summary: string;
  status: 'draft' | 'published';
  content: string;
  /**
   * Earlier bodies, oldest first, written as revisions before `content`.
   *
   * Exists so at least one seeded document has real history: "who changed the
   * bylaws and what did they say before" is the question the revisions table
   * exists to answer, and it cannot be seen on a hub where everything is at
   * version 1.
   */
  priorContent?: string[];
}

export const DOCUMENT_SEEDS: DocumentSeed[] = [
  {
    id: 'doc_seed_constitution',
    section: 'rules',
    title: 'Chapter Constitution',
    summary: 'How the club is governed, and how officers are elected.',
    status: 'published',
    priorContent: [
      '# Chapter Constitution\n\n' +
        '## Article I - Name\n\nThe name of this organization is the Baylor ACM Student Chapter.\n\n' +
        '## Article II - Purpose\n\nTo advance computing as a science and a profession among students.\n',
    ],
    content:
      '# Chapter Constitution\n\n' +
      '## Article I - Name\n\nThe name of this organization is the Baylor ACM Student Chapter.\n\n' +
      '## Article II - Purpose\n\nTo advance computing as a science and a profession among students, ' +
      'and to give members a place to build things together.\n\n' +
      '## Article III - Membership\n\nMembership is open to any enrolled student. ' +
      'There are no dues for the first semester.\n\n' +
      '## Article IV - Officers\n\nThe officers are the President, Vice President, Treasurer, ' +
      'and Marketing Director. Officers are elected each spring and serve for one academic year.\n',
  },
  {
    id: 'doc_seed_code_of_conduct',
    section: 'rules',
    title: 'Code of Conduct',
    summary: 'What we expect of each other at meetings and events.',
    status: 'published',
    content:
      '# Code of Conduct\n\n' +
      'Everyone is welcome here. Harassment of any kind is not tolerated, at any ' +
      'chapter event, in the group chat, or anywhere else the chapter gathers.\n\n' +
      'If something goes wrong, tell any officer. You will be taken seriously and ' +
      'you will not be asked to confront the other person yourself.\n',
  },
  {
    id: 'doc_seed_new_member_guide',
    section: 'onboarding',
    title: 'New Member Guide',
    summary: 'Start here if you just joined.',
    status: 'published',
    content:
      '# Welcome\n\n' +
      "You are in. Here is what to do in your first two weeks.\n\n" +
      '1. Join the GroupMe. Every announcement goes there first.\n' +
      '2. Come to one chapter meeting. They are on the calendar; you do not need to prepare anything.\n' +
      '3. Find one project or committee that sounds interesting and say so out loud to an officer.\n\n' +
      'That third one is the whole thing. People who attach themselves to one project stay; ' +
      'people who only attend meetings drift.\n',
  },
  {
    id: 'doc_seed_officer_handoff',
    section: 'onboarding',
    title: 'Officer Handoff Checklist',
    summary: 'What an outgoing officer owes the person replacing them.',
    status: 'published',
    content:
      '# Officer Handoff\n\n' +
      '- Transfer ownership of any account the chapter depends on, before the last week of term.\n' +
      '- Write down what went wrong this year. The next officer inherits the mistakes either way; ' +
      'they may as well inherit the explanation.\n' +
      '- Introduce your replacement to the faculty advisor in person.\n' +
      '- Leave the treasury reconciled, with receipts attached.\n',
  },
  {
    id: 'doc_seed_minutes_recent',
    section: 'meeting_notes',
    title: 'Officer Meeting - Semester Kickoff',
    summary: 'Budget, recruiting, and the spring speaker series.',
    status: 'published',
    content:
      '# Officer Meeting\n\n' +
      '**Present:** President, Treasurer, Marketing Director\n\n' +
      '## Budget\n\nOpening balance confirmed. Treasurer to reconcile last semester before the next meeting.\n\n' +
      '## Recruiting\n\nCallout event in week two. Marketing to post the week before, not the day before.\n\n' +
      '## Speaker series\n\nTwo speakers confirmed, one waiting on a date.\n',
  },
  {
    id: 'doc_seed_minutes_draft',
    section: 'meeting_notes',
    title: 'Officer Meeting - Week 3 (unfinished)',
    summary: 'Still being written up.',
    // Deliberately a draft: this is what makes the draft/published split
    // visible in the running app. A member signing in should not see this one.
    status: 'draft',
    content:
      '# Officer Meeting - Week 3\n\n' +
      '**Present:** \n\n## Discussed\n\n- Callout turnout was better than last year\n' +
      '- TODO: write up the rest of this before publishing\n',
  },
  {
    id: 'doc_seed_reimbursement',
    section: 'forms',
    title: 'Reimbursement Request',
    summary: 'How to get paid back for something you bought for the club.',
    status: 'published',
    content:
      '# Reimbursement\n\n' +
      'Send the Treasurer a photo of the receipt and one sentence saying what it was for. ' +
      'That is the whole process.\n\n' +
      'Do not spend chapter money without telling an officer first. ' +
      'Reimbursement is not guaranteed for a purchase nobody knew about.\n',
  },
  {
    id: 'doc_seed_room_booking',
    section: 'other',
    title: 'Booking a Room on Campus',
    summary: 'The part of event planning that always takes longest.',
    status: 'published',
    content:
      '# Booking a Room\n\n' +
      'Rooms open for reservation earlier than you expect and fill faster than you expect. ' +
      'Book the semester before if you can.\n\n' +
      'The advisor can unblock a request that is stuck. Ask early rather than the week of.\n',
  },
];
