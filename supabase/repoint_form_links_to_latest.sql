-- Point every live registration link at the newest published version of its
-- own form.
--
-- WHY: a form link is pinned to one published (immutable) form_versions row,
-- the one that existed when the link was created. Re-running
-- publish_intake_form.sql / publish_intake_form_es.sql after editing the
-- questionnaire publishes a NEW version, but existing links keep serving the
-- old one ("existing links keep pointing at the version they were created
-- with"). This moves them forward without changing any link's URL/token, so a
-- link already handed to a counselor keeps working and shows the current form.
--
-- Safe for past submissions: each form_submissions row pins its own
-- form_version_id, so what a family already answered is untouched.
--
-- Run order (Supabase SQL Editor, dev freely; prod only after a Software
-- Acceptance Review, same as every intake script):
--   1. supabase/publish_intake_form.sql
--   2. supabase/publish_intake_form_es.sql
--   3. this file
--
-- Re-runnable: a link already on its form's latest version is left alone.
-- Revoked links are left alone. A link only ever moves within its own form
-- (English stays English, Spanish stays Spanish).

with latest as (
  select distinct on (form_id) form_id, id as version_id, version
  from form_versions
  where published_at is not null
  order by form_id, version desc
)
update form_links fl
set form_version_id = latest.version_id
from form_versions cur
join latest on latest.form_id = cur.form_id
where fl.form_version_id = cur.id
  and fl.revoked_at is null
  and fl.form_version_id <> latest.version_id
returning fl.id, fl.label, fl.locale, cur.version as from_version, latest.version as to_version;

-- Check: every live link should now be on its form's latest version.
select fl.label, fl.locale, fv.version,
       fv.definition::text like '%can_reach_church_pickup%' as still_asks_church_pickup
from form_links fl
join form_versions fv on fv.id = fl.form_version_id
where fl.revoked_at is null
order by fl.label nulls last;
