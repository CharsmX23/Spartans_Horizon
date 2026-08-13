/*
  Data snapshot of the hosted Spartans_Horizon project (ref nfranoyezfepzltnmoik)
  Taken 2026-08-13, after the migration-history repair and the content typo pass.

  Docker is not installed on this machine, so `supabase db dump` cannot run. This
  snapshot was generated through the Management API instead. It covers row data for
  public tables only. It does NOT include:
    * auth.users (credentials) — logins cannot be restored from this file
    * schema/DDL — replay supabase/migrations/ for that

  To restore into an empty database, run this AFTER applying all migrations.
  Inserts are ordered so foreign keys resolve, and ON CONFLICT DO NOTHING makes the
  whole file safe to re-run. Verified by running it against the live database: every
  row conflicted, nothing was inserted, all counts unchanged.

  IMPORTANT: every public table's user_id is a foreign key to auth.users with
  ON DELETE CASCADE, and public.users rows are normally created by the
  on_auth_user_created trigger. Restoring these rows requires the matching auth
  accounts to exist first, or the FKs will reject them.

  Accounts present: alpha (real), bravo (test squadmate, password squadtest123).
*/

BEGIN;

-- squads (1 row)
INSERT INTO public.squads
SELECT (jsonb_populate_record(NULL::public.squads, elem)).*
FROM jsonb_array_elements($json$[
  {"id": "9409e0ce-8842-44b4-abce-6a4ccf364638", "name": "THE4", "join_code": "ZBYQ64", "created_at": "2026-07-29T04:05:28.532555+00:00", "created_by": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e"}
]$json$::jsonb) elem
ON CONFLICT DO NOTHING;

-- users (2 rows)
INSERT INTO public.users
SELECT (jsonb_populate_record(NULL::public.users, elem)).*
FROM jsonb_array_elements($json$[
  {"id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "squad_id": "9409e0ce-8842-44b4-abce-6a4ccf364638", "username": "alpha", "created_at": "2026-07-27T17:25:54.648289+00:00", "current_streak": 1, "last_checkin_date": "2026-08-08"},
  {"id": "3f501de2-b2f2-4f75-983a-ebdd7a34276b", "squad_id": "9409e0ce-8842-44b4-abce-6a4ccf364638", "username": "bravo", "created_at": "2026-08-12T18:36:31.765401+00:00", "current_streak": 0, "last_checkin_date": null}
]$json$::jsonb) elem
ON CONFLICT DO NOTHING;

-- goals (1 row)
INSERT INTO public.goals
SELECT (jsonb_populate_record(NULL::public.goals, elem)).*
FROM jsonb_array_elements($json$[
  {"id": "07b1038c-bc26-4236-999c-35716a28ba23", "title": "Start it now", "status": "active", "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "deadline": "2026-09-07", "goal_type": "long_term", "created_at": "2026-08-03T17:08:14.020645+00:00", "description": "It looks like a scuba"}
]$json$::jsonb) elem
ON CONFLICT DO NOTHING;

-- missions (1 row)
INSERT INTO public.missions
SELECT (jsonb_populate_record(NULL::public.missions, elem)).*
FROM jsonb_array_elements($json$[
  {"id": "7d6b8767-b0f1-4a41-a0d0-073daf8bc5bb", "title": "Adobe hack", "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "deadline": "2026-08-30", "priority": null, "progress": null, "created_at": "2026-07-30T17:14:01.15589+00:00"}
]$json$::jsonb) elem
ON CONFLICT DO NOTHING;

-- mission_phases (3 rows)
INSERT INTO public.mission_phases
SELECT (jsonb_populate_record(NULL::public.mission_phases, elem)).*
FROM jsonb_array_elements($json$[
  {"id": "4cd7d600-a158-475b-9373-ec371a2d0712", "title": "Registration", "status": "completed", "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "created_at": "2026-08-08T14:14:20.267+00:00", "mission_id": "7d6b8767-b0f1-4a41-a0d0-073daf8bc5bb", "description": null, "order_index": 0, "target_date": "2026-07-20"},
  {"id": "0dba8283-5589-4a17-a3ab-3ccc3dee5e35", "title": "Online Assessment", "status": "live", "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "created_at": "2026-08-08T14:14:53.606391+00:00", "mission_id": "7d6b8767-b0f1-4a41-a0d0-073daf8bc5bb", "description": null, "order_index": 1, "target_date": "2026-08-09"},
  {"id": "af2bc0cd-1454-49ba-9818-b16b017f222c", "title": "Initial Shortlist", "status": "pending", "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "created_at": "2026-08-08T14:15:31.993869+00:00", "mission_id": "7d6b8767-b0f1-4a41-a0d0-073daf8bc5bb", "description": null, "order_index": 2, "target_date": "2026-08-20"}
]$json$::jsonb) elem
ON CONFLICT DO NOTHING;

-- learning_paths (1 row)
INSERT INTO public.learning_paths
SELECT (jsonb_populate_record(NULL::public.learning_paths, elem)).*
FROM jsonb_array_elements($json$[
  {"id": "44afd3f4-cb18-442a-8a62-4a88a0aadfb2", "title": "To crack the Cognizant ACE role", "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "overview": "Be free", "created_at": "2026-08-08T16:49:26.488718+00:00", "foundational_terms": [], "total_timeline_weeks": 2}
]$json$::jsonb) elem
ON CONFLICT DO NOTHING;

-- path_phases (2 rows)
INSERT INTO public.path_phases
SELECT (jsonb_populate_record(NULL::public.path_phases, elem)).*
FROM jsonb_array_elements($json$[
  {"id": "aed78c36-ff17-49b7-9e7b-aab0469af757", "title": "AI Basics", "status": "completed", "path_id": "44afd3f4-cb18-442a-8a62-4a88a0aadfb2", "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "created_at": "2026-08-08T16:49:52.729151+00:00", "start_date": "2026-08-12", "description": null, "order_index": 0, "target_date": "2026-08-13"},
  {"id": "246fac99-cc27-4dc8-9366-83d823a6f7de", "title": "Agentic", "status": "live", "path_id": "44afd3f4-cb18-442a-8a62-4a88a0aadfb2", "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "created_at": "2026-08-08T16:50:16.904558+00:00", "start_date": "2026-08-14", "description": null, "order_index": 1, "target_date": "2026-08-15"}
]$json$::jsonb) elem
ON CONFLICT DO NOTHING;

-- habits (8 rows: 4 seeded per account)
INSERT INTO public.habits
SELECT (jsonb_populate_record(NULL::public.habits, elem)).*
FROM jsonb_array_elements($json$[
  {"id": "a42555c1-883c-4b26-a33d-b8b7ebc5e3d9", "icon": "Dumbbell", "title": "Workout", "active": false, "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "created_at": "2026-07-31T17:20:54.604971+00:00", "sort_order": 0},
  {"id": "880fb0e2-5532-4857-b8b9-5cc2dc02749c", "icon": "Code2", "title": "Deep work block", "active": false, "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "created_at": "2026-07-31T17:20:54.604971+00:00", "sort_order": 1},
  {"id": "2bcc3aa3-9590-4cca-b12e-729130508709", "icon": "BookOpen", "title": "Read 20 pages", "active": true, "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "created_at": "2026-07-31T17:20:54.604971+00:00", "sort_order": 2},
  {"id": "c142082b-218b-43bf-8150-31ef0c480535", "icon": "Moon", "title": "Sleep by 11pm", "active": true, "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "created_at": "2026-07-31T17:20:54.604971+00:00", "sort_order": 3},
  {"id": "4128f976-52a1-483a-b15e-3d2c08b32640", "icon": "Dumbbell", "title": "Workout", "active": true, "user_id": "3f501de2-b2f2-4f75-983a-ebdd7a34276b", "created_at": "2026-08-12T18:36:31.765401+00:00", "sort_order": 0},
  {"id": "85bd0078-083d-43f0-8776-17abd0c5b95d", "icon": "Code2", "title": "Deep work block", "active": true, "user_id": "3f501de2-b2f2-4f75-983a-ebdd7a34276b", "created_at": "2026-08-12T18:36:31.765401+00:00", "sort_order": 1},
  {"id": "83065e90-ae63-476a-9939-6aba37c4df90", "icon": "BookOpen", "title": "Read 20 pages", "active": true, "user_id": "3f501de2-b2f2-4f75-983a-ebdd7a34276b", "created_at": "2026-08-12T18:36:31.765401+00:00", "sort_order": 2},
  {"id": "2009d841-84ed-40d9-af31-dc3c14c5f1b9", "icon": "Moon", "title": "Sleep by 11pm", "active": true, "user_id": "3f501de2-b2f2-4f75-983a-ebdd7a34276b", "created_at": "2026-08-12T18:36:31.765401+00:00", "sort_order": 3}
]$json$::jsonb) elem
ON CONFLICT DO NOTHING;

-- habit_completions (0 rows) — nothing to restore

-- streak_logs (3 rows)
INSERT INTO public.streak_logs
SELECT (jsonb_populate_record(NULL::public.streak_logs, elem)).*
FROM jsonb_array_elements($json$[
  {"id": "48fc354b-1b8e-4aac-8c3c-027f9c61e457", "note": "I can see that you checked off Day 1 covering TCP/IP model & packet structure on your Networking & OS Fundamentals curriculum checklist. This shows clear, direct evidence of daily progress in your technical training.", "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "log_date": "2026-07-30", "verified": true, "photo_url": null, "created_at": "2026-07-30T13:31:04.316156+00:00"},
  {"id": "d7f92037-8627-4e2f-8210-9dc50c751f84", "note": "You have checked off Day 1 of your \"Networking & OS Fundamentals for Hackers\" curriculum covering TCP/IP model and packet structure. This shows clear, direct evidence of daily progress on your training.", "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "log_date": "2026-07-31", "verified": true, "photo_url": null, "created_at": "2026-07-31T16:37:48.617977+00:00"},
  {"id": "4c8f5d42-f2a7-447d-8cf9-a1f684ec2ce1", "note": "You are holding up detailed handwritten study notes on Analytical Instrumentation, covering topics such as qualitative analysis and electromagnetic radiation. This notebook page clearly shows evidence of active study and preparation.", "user_id": "5dd362f6-6b8e-4b85-9b7b-f9c299b1a73e", "log_date": "2026-08-08", "verified": true, "photo_url": null, "created_at": "2026-08-08T16:48:07.888486+00:00"}
]$json$::jsonb) elem
ON CONFLICT DO NOTHING;

-- skills (0 rows, superseded table), profile_settings (0 rows, dead) — nothing to restore

COMMIT;
