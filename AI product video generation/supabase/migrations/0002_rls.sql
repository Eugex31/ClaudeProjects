create or replace function public.is_member(target_org uuid, min_role public.member_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org
      and m.user_id = (select auth.uid())
      and case min_role
            when 'viewer' then true
            when 'editor' then m.role in ('owner', 'editor')
            when 'owner'  then m.role = 'owner'
          end
  );
$$;

create or replace function public.path_org(object_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(object_name, '/', 1)::uuid end;
$$;

-- anon never needs direct table access (share page uses the service role)
revoke all on all tables in schema public from anon;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;
alter table public.projects enable row level security;
alter table public.assets enable row level security;
alter table public.storyboards enable row level security;
alter table public.usage enable row level security;
alter table public.sample_templates enable row level security;

-- organizations: members read; owners may only rename (plan/quota are operator-only)
create policy org_select on public.organizations for select using (public.is_member(id, 'viewer'));
create policy org_update on public.organizations for update using (public.is_member(id, 'owner'));
revoke update on public.organizations from authenticated;
grant update (name) on public.organizations to authenticated;

-- memberships
create policy mem_select on public.memberships for select using (public.is_member(org_id, 'viewer'));
create policy mem_update on public.memberships for update
  using (public.is_member(org_id, 'owner') and user_id <> (select auth.uid()));
create policy mem_delete on public.memberships for delete
  using (public.is_member(org_id, 'owner') and user_id <> (select auth.uid()));
revoke update on public.memberships from authenticated;
grant update (role) on public.memberships to authenticated;

-- invites (owners only; invitees go through accept_invite)
create policy inv_all on public.invites for all
  using (public.is_member(org_id, 'owner')) with check (public.is_member(org_id, 'owner'));
revoke insert on public.invites from authenticated;
grant insert (org_id, email, role) on public.invites to authenticated;

-- projects
create policy proj_select on public.projects for select using (public.is_member(org_id, 'viewer'));
create policy proj_insert on public.projects for insert with check (public.is_member(org_id, 'editor'));
create policy proj_update on public.projects for update using (public.is_member(org_id, 'editor'));
create policy proj_delete on public.projects for delete using (public.is_member(org_id, 'editor'));
revoke insert on public.projects from anon, authenticated;
grant insert (org_id, name, language) on public.projects to authenticated;
revoke update on public.projects from authenticated;
grant update (name, language, status, share_token, updated_at) on public.projects to authenticated;

-- assets
create policy asset_select on public.assets for select using (public.is_member(org_id, 'viewer'));
create policy asset_insert on public.assets for insert with check (public.is_member(org_id, 'editor'));
create policy asset_delete on public.assets for delete using (public.is_member(org_id, 'editor'));

-- storyboards
create policy sb_select on public.storyboards for select using (public.is_member(org_id, 'viewer'));
create policy sb_insert on public.storyboards for insert with check (public.is_member(org_id, 'editor'));
create policy sb_update on public.storyboards for update using (public.is_member(org_id, 'editor'));
revoke update on public.storyboards from anon, authenticated;
grant update (parts, steps, manual_text) on public.storyboards to authenticated;

-- usage: read-only for members; written by increment_usage (service role)
create policy usage_select on public.usage for select using (public.is_member(org_id, 'viewer'));

-- sample_templates: no policies => only security definer functions / service role read it

-- storage
create policy files_select on storage.objects for select
  using (bucket_id = 'org-files' and public.is_member(public.path_org(name), 'viewer'));
create policy files_insert on storage.objects for insert
  with check (bucket_id = 'org-files' and public.is_member(public.path_org(name), 'editor'));
create policy files_delete on storage.objects for delete
  using (bucket_id = 'org-files' and public.is_member(public.path_org(name), 'editor'));

-- approval workflow
create or replace function public.stamp_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if coalesce((select jsonb_array_length(s.steps) from public.storyboards s where s.project_id = new.id), 0) = 0 then
      raise exception 'Cannot approve a project with no steps';
    end if;
    new.approved_by := coalesce(auth.uid(), new.approved_by);
    new.approved_at := now();
  elsif new.status = 'draft' then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger projects_stamp_approval before update on public.projects
  for each row execute function public.stamp_approval();

create or replace function public.reset_approval_on_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.steps is distinct from old.steps or new.parts is distinct from old.parts then
    update public.projects set status = 'draft' where id = new.project_id and status = 'approved';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger storyboards_reset_approval before update on public.storyboards
  for each row execute function public.reset_approval_on_edit();

create or replace function public.reset_approval_on_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.projects set status = 'draft' where id = new.project_id and status = 'approved';
  new.updated_at := now();
  return new;
end $$;
create trigger storyboards_reset_approval_insert before insert on public.storyboards
  for each row execute function public.reset_approval_on_insert();

-- invites
create or replace function public.accept_invite(invite_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invites;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into inv from public.invites
   where token = invite_token and accepted_at is null and expires_at > now();
  if inv.id is null then raise exception 'Invite is invalid or expired'; end if;
  if lower(inv.email) is distinct from lower((select email from auth.users where id = auth.uid())) then
    raise exception 'This invite was sent to a different email address';
  end if;
  insert into public.memberships (org_id, user_id, role) values (inv.org_id, auth.uid(), inv.role)
    on conflict (org_id, user_id) do nothing;
  update public.invites set accepted_at = now() where id = inv.id;
  return inv.org_id;
end $$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- usage increment (service role only)
create or replace function public.increment_usage(target_org uuid, target_period text)
returns void language sql security definer set search_path = '' as $$
  insert into public.usage (org_id, period, generations) values (target_org, target_period, 1)
  on conflict (org_id, period) do update set generations = public.usage.generations + 1;
$$;
revoke execute on function public.increment_usage(uuid, text) from public, anon, authenticated;

-- trigger functions are never callable directly
revoke execute on function public.stamp_approval() from public, anon, authenticated;
revoke execute on function public.reset_approval_on_edit() from public, anon, authenticated;
revoke execute on function public.reset_approval_on_insert() from public, anon, authenticated;
