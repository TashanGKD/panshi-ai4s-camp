import type { PublicContentPayloadSchemas } from '@panshi/contracts'

type OrganizationsContent = ReturnType<typeof PublicContentPayloadSchemas.organizations.parse>

export function OrganizationGroups({ organizations }: { organizations: OrganizationsContent }) {
  const roles = [...new Set(organizations.items.map((item) => item.role))]

  return <div className="organization-groups">
    {roles.map((role) => <section className="organization-group" key={role}>
      <h3>{role}</h3>
      <ul>
        {organizations.items
          .filter((item) => item.role === role)
          .map((item) => <li key={item.name}>{item.name}</li>)}
      </ul>
    </section>)}
  </div>
}
