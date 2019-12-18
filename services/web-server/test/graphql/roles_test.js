const assert = require('assert');
const taskcluster = require('taskcluster-client');
const { ApolloClient } = require('apollo-client');
const { InMemoryCache } = require('apollo-cache-inmemory');
const { HttpLink } = require('apollo-link-http');
const fetch = require('node-fetch');
const gql = require('graphql-tag');
const testing = require('taskcluster-lib-testing');
const helper = require('../helper');
const createRoleMutation = require('../fixtures/createRole.graphql');
const roleQuery = require('../fixtures/role.graphql');
const rolesQuery = require('../fixtures/roles.graphql');
const deleteRoleMutation = require('../fixtures/deleteRole.graphql');
const listRoleIdsQuery = require('../fixtures/listRoleIds.graphql')
const updateRoleMutation = require('../fixtures/updateRole.graphql');

// Removes any roles created during tests
const cleanUp = async (client) => {
  const response = await client.query({
    query: gql`${listRoleIdsQuery}`
  });

  response.data.listRoleIds.edges.forEach(async ({node}) => {
    await client.mutate({
      mutation: gql`${deleteRoleMutation}`,
      variables: {
        roleId: node.roleId
      }
    });
  })
}

helper.secrets.mockSuite(testing.suiteName(), [], function(mock, skipping) {
  helper.withEntities(mock, skipping);
  helper.withClients(mock, skipping);
  helper.withServer(mock, skipping);

  const getClient = () => {
    const cache = new InMemoryCache();
    const httpLink = new HttpLink({
      uri: `http://localhost:${helper.serverPort}/graphql`,
      fetch,
    });

    return new ApolloClient({ cache, link: httpLink });
  };

  suite('Roles GraphQL', function() {
    test('Role Query Works', async function() {
      const client = getClient();
      const roleId = taskcluster.slugid();
      const role = {
        scopes: ["scope1"],
        description: "Test Scope"
      }

      // 1. create role
      await client.mutate({
        mutation: gql`${createRoleMutation}`,
        variables: {
          roleId,
          role,
        },
      });

      // 2. get role
      const response = await client.query({
        query: gql`${roleQuery}`,
        variables: {
          roleId,
        },
      });

      assert.equal(response.data.role.roleId, roleId);

      await cleanUp(client);
    });

    test('Roles Query Works', async function() {
      const client = getClient();
      const roleId = taskcluster.slugid();
      const role = {
        scopes: ["scope1"],
        description: "Test Scope"
      }

      // 1. create roles
      await client.mutate({
        mutation: gql`${createRoleMutation}`,
        variables: {
          roleId: roleId,
          role: role,
        },
      });

      // 2. get roles
      const response = await client.query({
        query: gql`${rolesQuery}`
      });

      assert.equal(response.data.roles.length, 1);
      assert.equal(response.data.roles[0].roleId, roleId);

      await cleanUp(client);
    });

    test('List Role Ids Query Works', async function() {
      const client = getClient();
      const roleId = taskcluster.slugid();
      const role = {
        scopes: ["scope1"],
        description: "Test Scope 1"
      }

      // 1. create roles
      await client.mutate({
        mutation: gql`${createRoleMutation}`,
        variables: {
          roleId,
          role,
        },
      });

      // 2. get role Ids
      const response = await client.query({
        query: gql`${listRoleIdsQuery}`
      });

      assert.equal(response.data.listRoleIds.edges.length, 1);
      assert.equal(response.data.listRoleIds.edges[0].node.roleId, roleId);

      await cleanUp(client);
    });

    test('Create Role Mutation Works', async function() {
      const client = getClient();
      const roleId = taskcluster.slugid();
      const role = {
        scopes: ["scope1"],
        description: "Test Scope"
      }

      // 1. create role
      const response = await client.mutate({
        mutation: gql`${createRoleMutation}`,
        variables: {
          roleId,
          role,
        },
      });

      assert.equal(response.data.createRole.roleId, roleId);

      await cleanUp(client);
    });

    test('Update Role Mutation Works', async function() {
      const client = getClient();
      const roleId = taskcluster.slugid();
      const role = {
        scopes: ["scope1"],
        description: "Test Scope"
      }

      // 1. create role
      await client.mutate({
        mutation: gql`${createRoleMutation}`,
        variables: {
          roleId,
          role,
        },
      });

      // 2. update role
      role.scopes = ["scope2"]
      await client.mutate({
        mutation: gql`${updateRoleMutation}`,
        variables: {
          roleId,
          role,
        },
      });

      // 3. get role
      const response = await client.query({
        query: gql`${roleQuery}`,
        variables: {
          roleId,
        },
      });

      assert.equal(response.data.role.roleId, roleId);
      assert.equal(response.data.role.scopes[0], role.scopes[0]);

      await cleanUp(client);
    });

    test('Delete Role Mutation Works', async function() {
      const client = getClient();
      const roleId = taskcluster.slugid();
      const role = {
        scopes: ["scope1"],
        description: "Test Scope"
      }

      // 1. create role
      await client.mutate({
        mutation: gql`${createRoleMutation}`,
        variables: {
          roleId,
          role,
        },
      });

      // 2. delete role
      const response = await client.mutate({
        mutation: gql`${deleteRoleMutation}`,
        variables: {
          roleId: roleId
        }
      });

      assert.equal(response.data.deleteRole, roleId);
    });
  });
});
