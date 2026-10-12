create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  new_org uuid;
  new_project uuid;
  tpl public.sample_templates;
begin
  insert into public.organizations (name)
  values (left(split_part(new.email, '@', 1), 80) || '''s workspace')
  returning id into new_org;

  insert into public.memberships (org_id, user_id, role) values (new_org, new.id, 'owner');

  select * into tpl from public.sample_templates where id = 'bookshelf';
  if tpl.id is not null then
    insert into public.projects (org_id, name, language, created_by)
    values (new_org, tpl.project_name, 'en', new.id)
    returning id into new_project;

    insert into public.storyboards (project_id, org_id, parts, steps, manual_text)
    values (new_project, new_org, tpl.parts, tpl.steps, tpl.manual_text);

    insert into public.assets (org_id, project_id, kind, storage_path, filename)
    values (new_org, new_project, 'model', 'sample:' || tpl.model_path, tpl.model_path);

    -- stamp_approval keeps approved_by = new.id because auth.uid() is null during signup
    update public.projects set status = 'approved', approved_by = new.id where id = new_project;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
