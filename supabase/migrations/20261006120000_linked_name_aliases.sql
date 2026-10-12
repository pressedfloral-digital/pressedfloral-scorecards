-- Alternate names an app user appears under in Rippling (e.g. a former last name
-- still used in teammates' Manager column). Upload matching and the reporting
-- tree treat each alias exactly like the user's linked employee name.

alter table public.manager_profiles
  add column if not exists linked_name_aliases text[] not null default '{}';

-- Same as 20261001120000_rippling_assigned_manager, plus alias edges and roots.
create or replace function private.scorecards_manages_employee(target_employee_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  with recursive edges as (
    select re.manager as parent_node, re.full_name as child_node
    from public.rippling_employees re
    where re.manager is not null and re.manager <> ''
    union all
    select 'profile:' || re.assigned_manager_id::text, re.full_name
    from public.rippling_employees re
    where re.assigned_manager_id is not null
    union all
    -- An app user linked to an employee sits at that employee's spot in the tree.
    select p.linked_employee_name, 'profile:' || p.id::text
    from public.manager_profiles p
    where p.linked_employee_name is not null and p.linked_employee_name <> ''
    union all
    -- ...and at the spot of each of their alternate names.
    select alias, 'profile:' || p.id::text
    from public.manager_profiles p
    cross join lateral unnest(p.linked_name_aliases) as alias
    where alias <> ''
    union all
    -- Supervisor chain on the Users page.
    select 'profile:' || p.supervisor_id::text, 'profile:' || p.id::text
    from public.manager_profiles p
    where p.supervisor_id is not null
  ),
  reach as (
    select 'profile:' || id::text as node
    from public.manager_profiles
    where id = auth.uid()
    union
    select linked_employee_name
    from public.manager_profiles
    where id = auth.uid() and linked_employee_name is not null and linked_employee_name <> ''
    union
    select alias
    from public.manager_profiles p
    cross join lateral unnest(p.linked_name_aliases) as alias
    where p.id = auth.uid() and alias <> ''
    union
    select e.child_node
    from edges e
    join reach r on e.parent_node = r.node
  )
  select coalesce(target_employee_name, '') <> ''
    and exists (select 1 from reach where node = target_employee_name);
$$;

revoke execute on function private.scorecards_manages_employee(text) from public, anon;
grant execute on function private.scorecards_manages_employee(text) to authenticated;
