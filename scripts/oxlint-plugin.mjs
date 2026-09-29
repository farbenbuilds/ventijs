// Rules that make CODING_CONVENTION.md mechanically checkable. Oxlint has no
// native rule for classes, prototype mutation, enums, or emoji, so they live
// here as a local plugin using the ESLint-compatible API:
// https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html
//
// The default export is required by the plugin API and is exempted from
// import/no-default-export in .oxlintrc.json.

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

function isMemberNamed(node, name) {
  if (node.type !== "MemberExpression") return false;
  if (node.property.type !== "Identifier") return false;
  return node.property.name === name;
}

function isPrototypeReference(node) {
  return isMemberNamed(node, "prototype");
}

function isPrototypeMutationTarget(node) {
  if (node.type !== "MemberExpression") return false;
  if (isMemberNamed(node, "__proto__")) return true;
  if (isPrototypeReference(node)) return true;
  if (node.object.type !== "MemberExpression") return false;
  return isPrototypeReference(node.object);
}

function isSetPrototypeOfCall(node) {
  if (node.type !== "CallExpression") return false;
  return isMemberNamed(node.callee, "setPrototypeOf");
}

const noOop = {
  meta: {
    type: "problem",
    docs: { description: "Ban classes, this, and prototype mutation" },
  },
  create(context) {
    const report = (node, message) => context.report({ message, node });
    const reportMutation = (node) => {
      if (isPrototypeMutationTarget(node.left)) report(node, "Prototype mutation is banned.");
    };
    return {
      ClassDeclaration: (node) =>
        report(node, "Classes are banned; return a state record from a factory function."),
      ClassExpression: (node) =>
        report(
          node,
          "Class expressions are banned; return a state record from a factory function.",
        ),
      ThisExpression: (node) =>
        report(node, "`this` is banned; pass state to free functions explicitly."),
      AssignmentExpression: reportMutation,
      CallExpression: (node) => {
        if (isSetPrototypeOfCall(node)) report(node, "Prototype mutation is banned.");
      },
    };
  },
};

const noEnum = {
  meta: {
    type: "problem",
    docs: { description: "Ban enums in favor of as const unions" },
  },
  create(context) {
    return {
      TSEnumDeclaration: (node) => {
        context.report({ message: "Enums are banned; use `as const` unions.", node });
      },
    };
  },
};

const noEmoji = {
  meta: {
    type: "problem",
    docs: { description: "Ban emoji code points in source files" },
  },
  create(context) {
    return {
      Program: (node) => {
        if (!EMOJI_PATTERN.test(context.sourceCode.text)) return;
        context.report({
          message: "Emoji code points are banned in code, comments, and strings.",
          node,
        });
      },
    };
  },
};

export default {
  meta: { name: "ventiws" },
  rules: {
    "no-emoji": noEmoji,
    "no-enum": noEnum,
    "no-oop": noOop,
  },
};
