/**
 * Taxonomy Manager
 * Manages multi-label bushy tree taxonomy for compound labels
 */

class TaxonomyManager {
  constructor(db) {
    this.db = db;
    this.logger = console;
  }

  /**
   * Create hierarchical taxonomy structure
   */
  async createTaxonomy(projectId, taxonomyData) {
    try {
      this.logger.log(`🌳 Creating taxonomy for project ${projectId}`);
      
      const createdClasses = [];
      
      // Create root classes first
      for (const classData of taxonomyData.classes) {
        if (!classData.parent_ids || classData.parent_ids.length === 0) {
          const labelClass = await this.createLabelClass(projectId, classData);
          createdClasses.push(labelClass);
        }
      }
      
      // Create child classes
      for (const classData of taxonomyData.classes) {
        if (classData.parent_ids && classData.parent_ids.length > 0) {
          const labelClass = await this.createLabelClass(projectId, classData);
          createdClasses.push(labelClass);
          
          // Create hierarchy relationships
          for (const parentId of classData.parent_ids) {
            await this.createHierarchyRelationship(parentId, labelClass.id, 'is_a');
          }
        }
      }
      
      // Create compound classes
      for (const compoundData of taxonomyData.compounds || []) {
        const compoundClass = await this.createCompoundClass(projectId, compoundData);
        createdClasses.push(compoundClass);
      }
      
      this.logger.log(`✅ Created taxonomy: ${createdClasses.length} classes`);
      
      return {
        project_id: projectId,
        classes: createdClasses,
        hierarchy_count: taxonomyData.classes.filter(c => c.parent_ids?.length > 0).length
      };
      
    } catch (error) {
      this.logger.error('Failed to create taxonomy:', error);
      throw error;
    }
  }

  /**
   * Create a single label class
   */
  async createLabelClass(projectId, classData) {
    try {
      const labelClass = await this.db.LabelClass.create({
        projectId,
        name: classData.name,
        displayName: classData.display_name || classData.name,
        description: classData.description,
        colorHex: classData.color_hex || this.generateRandomColor(),
        isCompound: classData.is_compound || false,
        compoundComponents: classData.compound_components || null,
        level: classData.level || 0,
        isActive: classData.is_active !== false
      });
      
      return labelClass;
      
    } catch (error) {
      this.logger.error(`Failed to create label class ${classData.name}:`, error);
      throw error;
    }
  }

  /**
   * Create compound class with component relationships
   */
  async createCompoundClass(projectId, compoundData) {
    try {
      // Find component class IDs
      const componentIds = [];
      for (const componentName of compoundData.components) {
        const component = await this.db.LabelClass.findOne({
          where: { projectId, name: componentName }
        });
        if (component) {
          componentIds.push(component.id);
        }
      }
      
      const compoundClass = await this.db.LabelClass.create({
        projectId,
        name: compoundData.name,
        displayName: compoundData.display_name || compoundData.name,
        description: compoundData.description,
        colorHex: compoundData.color_hex || this.generateRandomColor(),
        isCompound: true,
        compoundComponents: componentIds,
        level: compoundData.level || 1,
        isActive: true
      });
      
      // Create relationships to components
      for (const componentId of componentIds) {
        await this.createHierarchyRelationship(componentId, compoundClass.id, 'part_of');
      }
      
      return compoundClass;
      
    } catch (error) {
      this.logger.error(`Failed to create compound class ${compoundData.name}:`, error);
      throw error;
    }
  }

  /**
   * Create hierarchy relationship
   */
  async createHierarchyRelationship(parentId, childId, relationshipType = 'is_a', strength = 1.0) {
    try {
      const relationship = await this.db.LabelHierarchy.create({
        parentId,
        childId,
        relationshipType,
        strength
      });
      
      return relationship;
      
    } catch (error) {
      this.logger.error(`Failed to create hierarchy relationship ${parentId}->${childId}:`, error);
      throw error;
    }
  }

  /**
   * Get taxonomy tree for project
   */
  async getTaxonomyTree(projectId) {
    try {
      // Get all classes
      const classes = await this.db.LabelClass.findAll({
        where: { projectId, isActive: true },
        order: [['level', 'ASC'], ['name', 'ASC']]
      });
      
      // Get all relationships
      const relationships = await this.db.LabelHierarchy.findAll({
        include: [
          { model: this.db.LabelClass, as: 'parent', where: { projectId } },
          { model: this.db.LabelClass, as: 'child', where: { projectId } }
        ]
      });
      
      // Build tree structure
      const tree = this.buildTreeStructure(classes, relationships);
      
      return {
        project_id: projectId,
        total_classes: classes.length,
        total_relationships: relationships.length,
        tree: tree
      };
      
    } catch (error) {
      this.logger.error(`Failed to get taxonomy tree for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Build hierarchical tree structure
   */
  buildTreeStructure(classes, relationships) {
    try {
      // Create class lookup
      const classMap = {};
      classes.forEach(cls => {
        classMap[cls.id] = {
          ...cls.toJSON(),
          children: [],
          parents: []
        };
      });
      
      // Add relationships
      relationships.forEach(rel => {
        const parent = classMap[rel.parentId];
        const child = classMap[rel.childId];
        
        if (parent && child) {
          parent.children.push({
            ...child,
            relationship_type: rel.relationshipType,
            strength: rel.strength
          });
          child.parents.push({
            id: parent.id,
            name: parent.name,
            relationship_type: rel.relationshipType
          });
        }
      });
      
      // Find root nodes (no parents)
      const rootNodes = classes
        .filter(cls => !relationships.some(rel => rel.childId === cls.id))
        .map(cls => classMap[cls.id]);
      
      return rootNodes;
      
    } catch (error) {
      this.logger.error('Failed to build tree structure:', error);
      return [];
    }
  }

  /**
   * Resolve compound labels
   */
  async resolveCompoundLabels(projectId, roiLabels) {
    try {
      const resolvedLabels = [];
      
      for (const label of roiLabels) {
        const labelClass = await this.db.LabelClass.findByPk(label.class_id);
        
        if (labelClass && labelClass.isCompound && labelClass.compoundComponents) {
          // Expand compound label to components
          for (const componentId of labelClass.compoundComponents) {
            resolvedLabels.push({
              ...label,
              class_id: componentId,
              source: 'compound_expansion',
              parent_compound_id: labelClass.id
            });
          }
        } else {
          // Keep original label
          resolvedLabels.push(label);
        }
      }
      
      return resolvedLabels;
      
    } catch (error) {
      this.logger.error('Failed to resolve compound labels:', error);
      return roiLabels;
    }
  }

  /**
   * Get label suggestions based on hierarchy
   */
  async getLabelSuggestions(projectId, currentLabels, maxSuggestions = 10) {
    try {
      const suggestions = [];
      
      // Get hierarchy relationships
      const relationships = await this.db.LabelHierarchy.findAll({
        include: [
          { model: this.db.LabelClass, as: 'parent', where: { projectId } },
          { model: this.db.LabelClass, as: 'child', where: { projectId } }
        ]
      });
      
      // For each current label, suggest related labels
      for (const currentLabel of currentLabels) {
        // Find parent suggestions
        const parentRels = relationships.filter(rel => rel.childId === currentLabel.class_id);
        parentRels.forEach(rel => {
          suggestions.push({
            class_id: rel.parentId,
            class_name: rel.parent.name,
            suggestion_type: 'parent',
            relationship: rel.relationshipType,
            strength: rel.strength,
            confidence: 0.8
          });
        });
        
        // Find sibling suggestions
        const siblingRels = relationships.filter(rel => 
          parentRels.some(prel => prel.parentId === rel.parentId) && 
          rel.childId !== currentLabel.class_id
        );
        siblingRels.forEach(rel => {
          suggestions.push({
            class_id: rel.childId,
            class_name: rel.child.name,
            suggestion_type: 'sibling',
            relationship: 'sibling',
            strength: rel.strength * 0.7,
            confidence: 0.6
          });
        });
      }
      
      // Remove duplicates and sort by confidence
      const uniqueSuggestions = suggestions
        .filter((suggestion, index, self) => 
          index === self.findIndex(s => s.class_id === suggestion.class_id)
        )
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, maxSuggestions);
      
      return uniqueSuggestions;
      
    } catch (error) {
      this.logger.error('Failed to get label suggestions:', error);
      return [];
    }
  }

  /**
   * Validate taxonomy consistency
   */
  async validateTaxonomy(projectId) {
    try {
      const issues = [];
      
      // Get all classes and relationships
      const classes = await this.db.LabelClass.findAll({ where: { projectId } });
      const relationships = await this.db.LabelHierarchy.findAll({
        include: [
          { model: this.db.LabelClass, as: 'parent', where: { projectId } },
          { model: this.db.LabelClass, as: 'child', where: { projectId } }
        ]
      });
      
      // Check for circular dependencies
      const circularDeps = this.detectCircularDependencies(relationships);
      if (circularDeps.length > 0) {
        issues.push({
          type: 'circular_dependency',
          message: 'Circular dependencies detected',
          details: circularDeps
        });
      }
      
      // Check for orphaned classes
      const orphanedClasses = classes.filter(cls => 
        cls.level > 0 && !relationships.some(rel => rel.childId === cls.id)
      );
      if (orphanedClasses.length > 0) {
        issues.push({
          type: 'orphaned_classes',
          message: 'Classes with level > 0 but no parents',
          details: orphanedClasses.map(cls => ({ id: cls.id, name: cls.name }))
        });
      }
      
      // Check compound class components
      const invalidCompounds = [];
      for (const cls of classes.filter(c => c.isCompound)) {
        if (!cls.compoundComponents || cls.compoundComponents.length === 0) {
          invalidCompounds.push({ id: cls.id, name: cls.name });
        }
      }
      if (invalidCompounds.length > 0) {
        issues.push({
          type: 'invalid_compounds',
          message: 'Compound classes without components',
          details: invalidCompounds
        });
      }
      
      return {
        is_valid: issues.length === 0,
        issues: issues,
        total_classes: classes.length,
        total_relationships: relationships.length
      };
      
    } catch (error) {
      this.logger.error('Failed to validate taxonomy:', error);
      throw error;
    }
  }

  /**
   * Detect circular dependencies in hierarchy
   */
  detectCircularDependencies(relationships) {
    const graph = {};
    const visited = new Set();
    const recursionStack = new Set();
    const cycles = [];
    
    // Build adjacency list
    relationships.forEach(rel => {
      if (!graph[rel.parentId]) graph[rel.parentId] = [];
      graph[rel.parentId].push(rel.childId);
    });
    
    // DFS to detect cycles
    const dfs = (node, path) => {
      if (recursionStack.has(node)) {
        const cycleStart = path.indexOf(node);
        cycles.push(path.slice(cycleStart));
        return;
      }
      
      if (visited.has(node)) return;
      
      visited.add(node);
      recursionStack.add(node);
      path.push(node);
      
      if (graph[node]) {
        for (const neighbor of graph[node]) {
          dfs(neighbor, [...path]);
        }
      }
      
      recursionStack.delete(node);
    };
    
    // Check all nodes
    Object.keys(graph).forEach(node => {
      if (!visited.has(parseInt(node))) {
        dfs(parseInt(node), []);
      }
    });
    
    return cycles;
  }

  /**
   * Generate random color for new classes
   */
  generateRandomColor() {
    const colors = [
      '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
      '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}

module.exports = TaxonomyManager;
