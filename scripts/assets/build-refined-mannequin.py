"""Build the bundled segmented CC0 mannequin from Blender Studio source."""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Vector


FEMALE_COLLECTION = "Body Female - Primitve (Realistic)"
MALE_COLLECTION = "Body Male - Primitve (Realistic)"
SUBDIVISION_LEVEL = 1

EXCLUDED_SOURCE_OBJECTS = {
    "GEO-breasts_primitive_female_realistic",
}

SOURCE_PARTS = {
    "pelvis": (
        "GEO-pelvis_female_primitive_realistic",
        "GEO-pelvis_male_primitive_realistic",
    ),
    "belly": (
        "GEO-belly_primitive_female_realistic",
        "GEO-belly_male_primitive_realistic",
    ),
    "chest": (
        "GEO-chest_primitive_female_realistic",
        "GEO-chest_male_primitive_realistic",
    ),
    "shoulder_l": (
        "GEO-shoulder_primitive_female_realistic.L",
        "GEO-shoulder_male_primitive_realistic.L",
    ),
    "shoulder_r": (
        "GEO-shoulder_primitive_female_realistic.R",
        "GEO-shoulder_male_primitive_realistic.R",
    ),
    "neck": (
        "GEO-neck_primitive_female_realistic",
        "GEO-neck_male_primitive_realistic",
    ),
    "head": (
        "GEO-head_primitive_female_realistic",
        "GEO-head_male_primitive_realistic",
    ),
    "ear_l": (
        "GEO-ear_primitve_female_realistic.L",
        "GEO-ear_male_primitive_realistic.L",
    ),
    "ear_r": (
        "GEO-ear_primitve_female_realistic.R",
        "GEO-ear_male_primitive_realistic.R",
    ),
    "eye_l": (
        "GEO-eye_primitve_female_realistic.L",
        "GEO-eye_male_primitive_realistic.L",
    ),
    "eye_r": (
        "GEO-eye_primitve_female_realistic.R",
        "GEO-eye_male_primitive_realistic.R",
    ),
    "eyelid_lower_l": (
        "GEO-eyelid_lower_primitve_female_realistic.L",
        "GEO-eyelid_lower_male_primitive_realistic.L",
    ),
    "eyelid_lower_r": (
        "GEO-eyelid_lower_primitve_female_realistic.R",
        "GEO-eyelid_lower_male_primitive_realistic.R",
    ),
    "eyelid_upper_l": (
        "GEO-eyelid_upper_primitve_female_realistic.L",
        "GEO-eyelid_upper_male_primitive_realistic.L",
    ),
    "eyelid_upper_r": (
        "GEO-eyelid_upper_primitve_female_realistic.R",
        "GEO-eyelid_upper_male_primitive_realistic.R",
    ),
    "nose_bridge": (
        "GEO-nose_bridge_primitve_female_realistic",
        "GEO-nose_bridge_male_primitive_realistic",
    ),
    "nose": (
        "GEO-nose_primitve_female_realistic",
        "GEO-nose_male_primitive_realistic",
    ),
    "upper_arm_l": (
        "GEO-arm_upper_primitive_female_realistic.L",
        "GEO-arm_upper_male_primitive_realistic.L",
    ),
    "upper_arm_r": (
        "GEO-arm_upper_primitive_female_realistic.R",
        "GEO-arm_upper_male_primitive_realistic.R",
    ),
    "forearm_l": (
        "GEO-arm_lower_primitive_female_realistic.L",
        "GEO-arm_lower_male_primitive_realistic.L",
    ),
    "forearm_r": (
        "GEO-arm_lower_primitive_female_realistic.R",
        "GEO-arm_lower_male_primitive_realistic.R",
    ),
    "hand_base_l": (
        "GEO-hand_primitive_female_realistic.L",
        "GEO-hand_male_primitive_realistic.L",
    ),
    "hand_base_r": (
        "GEO-hand_primitive_female_realistic.R",
        "GEO-hand_male_primitive_realistic.R",
    ),
    "thumb_l": (
        "GEO-thumb_primitive_female_realistic.L",
        "GEO-thumb_male_primitive_realistic.L",
    ),
    "thumb_r": (
        "GEO-thumb_primitive_female_realistic.R",
        "GEO-thumb_male_primitive_realistic.R",
    ),
    "finger_index_l": (
        "GEO-finger_index_primitive_female_realistic.L",
        "GEO-finger_index_male_primitive_realistic.L",
    ),
    "finger_index_r": (
        "GEO-finger_index_primitive_female_realistic.R",
        "GEO-finger_index_male_primitive_realistic.R",
    ),
    "finger_middle_l": (
        "GEO-finger_middle_primitive_female_realistic.L",
        "GEO-finger_middle_male_primitive_realistic.L",
    ),
    "finger_middle_r": (
        "GEO-finger_middle_primitive_female_realistic.R",
        "GEO-finger_middle_male_primitive_realistic.R",
    ),
    "finger_ring_l": (
        "GEO-finger_ring_primitive_female_realistic.L",
        "GEO-finger_ring_male_primitive_realistic.L",
    ),
    "finger_ring_r": (
        "GEO-finger_ring_primitive_female_realistic.R",
        "GEO-finger_ring_male_primitive_realistic.R",
    ),
    "finger_pinky_l": (
        "GEO-finger_pinky_primitive_female_realistic.L",
        "GEO-finger_pinky_male_primitive_realistic.L",
    ),
    "finger_pinky_r": (
        "GEO-finger_pinky_primitive_female_realistic.R",
        "GEO-finger_pinky_male_primitive_realistic.R",
    ),
    "upper_leg_l": (
        "GEO-leg_upper_primitive_female_realistic.L",
        "GEO-leg_upper_male_primitive_realistic.L",
    ),
    "upper_leg_r": (
        "GEO-leg_upper_primitive_female_realistic.R",
        "GEO-leg_upper_male_primitive_realistic.R",
    ),
    "lower_leg_l": (
        "GEO-leg_lower_primitive_female_realistic.L",
        "GEO-leg_lower_male_primitive_realistic.L",
    ),
    "lower_leg_r": (
        "GEO-leg_lower_primitive_female_realistic.R",
        "GEO-leg_lower_male_primitive_realistic.R",
    ),
    "foot_base_l": (
        "GEO-foot_primitive_female_realistic.L",
        "GEO-foot.005_male_primitive_realistic.L",
    ),
    "foot_base_r": (
        "GEO-foot_primitive_female_realistic.R",
        "GEO-foot.005_male_primitive_realistic.R",
    ),
    "toe_big_l": (
        "GEO-toe_big_primitive_female_realistic.L",
        "GEO-teo_big_male_primitive_realistic.L",
    ),
    "toe_big_r": (
        "GEO-toe_big_primitive_female_realistic.R",
        "GEO-teo_big_male_primitive_realistic.R",
    ),
    "toe_index_l": (
        "GEO-toe_index_primitive_female_realistic.L",
        "GEO-toe_index_male_primitive_realistic.L",
    ),
    "toe_index_r": (
        "GEO-toe_index_primitive_female_realistic.R",
        "GEO-toe_index_male_primitive_realistic.R",
    ),
    "toe_middle_l": (
        "GEO-toe_middle_primitive_female_realistic.L",
        "GEO-toe_middle_male_primitive_realistic.L",
    ),
    "toe_middle_r": (
        "GEO-toe_middle_primitive_female_realistic.R",
        "GEO-toe_middle_male_primitive_realistic.R",
    ),
    "toe_ring_l": (
        "GEO-toe_ring_primitive_female_realistic.L",
        "GEO-toe_ring_male_primitive_realistic.L",
    ),
    "toe_ring_r": (
        "GEO-toe_ring_primitive_female_realistic.R",
        "GEO-toe_ring_male_primitive_realistic.R",
    ),
    "toe_pinky_l": (
        "GEO-toe_pinky_primitive_female_realistic.L",
        "GEO-toe_pinky_male_primitive_realistic.L",
    ),
    "toe_pinky_r": (
        "GEO-toe_pinky_primitive_female_realistic.R",
        "GEO-toe_pinky_male_primitive_realistic.R",
    ),
}

# Finger geometry is joined into each hand; toe geometry is joined into each foot.
SECTION_PARTS = {
    "pelvis": ("pelvis",),
    "torso": ("belly", "chest", "shoulder_l", "shoulder_r"),
    "neck": ("neck",),
    "head": (
        "head",
        "ear_l",
        "ear_r",
        "eye_l",
        "eye_r",
        "eyelid_lower_l",
        "eyelid_lower_r",
        "eyelid_upper_l",
        "eyelid_upper_r",
        "nose_bridge",
        "nose",
    ),
    "upper_arm_l": ("upper_arm_l",),
    "forearm_l": ("forearm_l",),
    "hand_l": (
        "hand_base_l",
        "thumb_l",
        "finger_index_l",
        "finger_middle_l",
        "finger_ring_l",
        "finger_pinky_l",
    ),
    "upper_arm_r": ("upper_arm_r",),
    "forearm_r": ("forearm_r",),
    "hand_r": (
        "hand_base_r",
        "thumb_r",
        "finger_index_r",
        "finger_middle_r",
        "finger_ring_r",
        "finger_pinky_r",
    ),
    "upper_leg_l": ("upper_leg_l",),
    "lower_leg_l": ("lower_leg_l",),
    "foot_l": (
        "foot_base_l",
        "toe_big_l",
        "toe_index_l",
        "toe_middle_l",
        "toe_ring_l",
        "toe_pinky_l",
    ),
    "upper_leg_r": ("upper_leg_r",),
    "lower_leg_r": ("lower_leg_r",),
    "foot_r": (
        "foot_base_r",
        "toe_big_r",
        "toe_index_r",
        "toe_middle_r",
        "toe_ring_r",
        "toe_pinky_r",
    ),
}


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(arguments)


def source_objects(collection_name: str, index: int) -> dict[str, bpy.types.Object]:
    collection = bpy.data.collections.get(collection_name)
    if collection is None:
        raise RuntimeError(f"SOURCE_COLLECTION_MISSING:{collection_name}")
    available = {obj.name: obj for obj in collection.all_objects if obj.type == "MESH"}
    result = {}
    for key, names in SOURCE_PARTS.items():
        name = names[index]
        obj = available.get(name)
        if obj is None:
            raise RuntimeError(f"SOURCE_OBJECT_MISSING:{key}")
        result[key] = obj
    return result


def body_normalization(objects: dict[str, bpy.types.Object]) -> tuple[Vector, float]:
    minimum = Vector((float("inf"), float("inf"), float("inf")))
    maximum = Vector((float("-inf"), float("-inf"), float("-inf")))
    for obj in objects.values():
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            for axis in range(3):
                minimum[axis] = min(minimum[axis], point[axis])
                maximum[axis] = max(maximum[axis], point[axis])
    height = maximum.z - minimum.z
    if height <= 0:
        raise RuntimeError("SOURCE_BODY_BOUNDS_INVALID")
    origin = Vector(
        (
            (minimum.x + maximum.x) / 2,
            (minimum.y + maximum.y) / 2,
            minimum.z,
        )
    )
    return origin, height


def normalized_vertices(
    obj: bpy.types.Object,
    origin: Vector,
    height: float,
) -> list[Vector]:
    return [(obj.matrix_world @ vertex.co - origin) / height for vertex in obj.data.vertices]


def polygon_signature(obj: bpy.types.Object) -> list[tuple[int, ...]]:
    return [tuple(polygon.vertices) for polygon in obj.data.polygons]


def average_source_mesh(
    female: bpy.types.Object,
    male: bpy.types.Object,
    female_normalization: tuple[Vector, float],
    male_normalization: tuple[Vector, float],
) -> tuple[list[Vector], list[tuple[int, ...]]]:
    female_faces = polygon_signature(female)
    male_faces = polygon_signature(male)
    if len(female.data.vertices) != len(male.data.vertices) or female_faces != male_faces:
        raise RuntimeError(f"SOURCE_TOPOLOGY_MISMATCH:{female.name}")
    female_vertices = normalized_vertices(female, *female_normalization)
    male_vertices = normalized_vertices(male, *male_normalization)
    vertices = [
        (female_point + male_point) / 2
        for female_point, male_point in zip(female_vertices, male_vertices, strict=True)
    ]
    return vertices, female_faces


def centroid(points: list[Vector]) -> Vector:
    if not points:
        raise RuntimeError("SOURCE_PART_EMPTY")
    total = Vector((0.0, 0.0, 0.0))
    for point in points:
        total += point
    return total / len(points)


def combined_centroid(parts: dict[str, tuple[list[Vector], list[tuple[int, ...]]]], keys: tuple[str, ...]) -> Vector:
    points = [point for key in keys for point in parts[key][0]]
    return centroid(points)


def section_axes(parts: dict[str, tuple[list[Vector], list[tuple[int, ...]]]]) -> dict[str, Vector]:
    axes = {section: Vector((0.0, 0.0, -1.0)) for section in SECTION_PARTS}
    for side in ("l", "r"):
        upper = centroid(parts[f"upper_arm_{side}"][0])
        forearm = centroid(parts[f"forearm_{side}"][0])
        hand = centroid(parts[f"hand_base_{side}"][0])
        fingers = combined_centroid(
            parts,
            (
                f"finger_index_{side}",
                f"finger_middle_{side}",
                f"finger_ring_{side}",
                f"finger_pinky_{side}",
            ),
        )
        upper_leg = centroid(parts[f"upper_leg_{side}"][0])
        lower_leg = centroid(parts[f"lower_leg_{side}"][0])
        foot = centroid(parts[f"foot_base_{side}"][0])
        axes[f"upper_arm_{side}"] = (forearm - upper).normalized()
        axes[f"forearm_{side}"] = (hand - forearm).normalized()
        axes[f"hand_{side}"] = (fingers - hand).normalized()
        axes[f"upper_leg_{side}"] = (lower_leg - upper_leg).normalized()
        axes[f"lower_leg_{side}"] = (foot - lower_leg).normalized()
    return axes


def create_section_mesh(
    section_id: str,
    keys: tuple[str, ...],
    parts: dict[str, tuple[list[Vector], list[tuple[int, ...]]]],
) -> bpy.types.Object:
    vertices: list[Vector] = []
    faces: list[tuple[int, ...]] = []
    for key in keys:
        part_vertices, part_faces = parts[key]
        offset = len(vertices)
        vertices.extend(part_vertices)
        faces.extend(tuple(index + offset for index in face) for face in part_faces)
    mesh = bpy.data.meshes.new(f"{section_id}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(section_id, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def runtime_basis(direction: Vector) -> tuple[Vector, Vector, Vector]:
    distal = direction.normalized()
    front = Vector((0.0, -1.0, 0.0))
    front -= distal * front.dot(distal)
    if front.length < 1e-6:
        front = Vector((0.0, 0.0, 1.0))
        front -= distal * front.dot(distal)
    front.normalize()
    right = front.cross(distal).normalized()
    return right, -distal, front


def normalize_section(obj: bpy.types.Object, direction: Vector) -> None:
    right, up, front = runtime_basis(direction)
    runtime_points = [
        Vector((vertex.co.dot(right), vertex.co.dot(up), vertex.co.dot(front)))
        for vertex in obj.data.vertices
    ]
    minimum = Vector((float("inf"), float("inf"), float("inf")))
    maximum = Vector((float("-inf"), float("-inf"), float("-inf")))
    for point in runtime_points:
        for axis in range(3):
            minimum[axis] = min(minimum[axis], point[axis])
            maximum[axis] = max(maximum[axis], point[axis])
    size = maximum - minimum
    if min(size) <= 1e-8:
        raise RuntimeError(f"SECTION_BOUNDS_INVALID:{obj.name}")
    center = (minimum + maximum) / 2
    for vertex, point in zip(obj.data.vertices, runtime_points, strict=True):
        normalized = Vector(
            tuple((point[axis] - center[axis]) / size[axis] for axis in range(3))
        )
        # Blender's glTF Y-up export maps (x, y, z) to (x, z, -y).
        vertex.co = Vector((normalized.x, -normalized.z, normalized.y))
    obj.data.update()


def prepare_section(
    obj: bpy.types.Object,
    direction: Vector,
    material: bpy.types.Material,
) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new(name="subdivision", type="SUBSURF")
    modifier.subdivision_type = "CATMULL_CLARK"
    modifier.levels = SUBDIVISION_LEVEL
    modifier.render_levels = SUBDIVISION_LEVEL
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    normalize_section(obj, direction)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.data.materials.clear()
    obj.data.materials.append(material)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.users == 0:
            bpy.data.collections.remove(collection)


def build(source: Path, output: Path) -> None:
    if not source.is_file():
        raise RuntimeError("SOURCE_FILE_MISSING")
    bpy.ops.wm.open_mainfile(filepath=str(source))
    female_objects = source_objects(FEMALE_COLLECTION, 0)
    male_objects = source_objects(MALE_COLLECTION, 1)
    if EXCLUDED_SOURCE_OBJECTS.intersection(obj.name for obj in female_objects.values()):
        raise RuntimeError("EXCLUDED_SOURCE_OBJECT_SELECTED")
    female_normalization = body_normalization(female_objects)
    male_normalization = body_normalization(male_objects)
    parts = {
        key: average_source_mesh(
            female_objects[key],
            male_objects[key],
            female_normalization,
            male_normalization,
        )
        for key in SOURCE_PARTS
    }
    axes = section_axes(parts)
    clear_scene()

    material = bpy.data.materials.new("refined_white")
    material.diffuse_color = (0.82, 0.84, 0.86, 1.0)
    material.metallic = 0.0
    material.roughness = 0.72
    outputs = []
    for section_id, keys in SECTION_PARTS.items():
        obj = create_section_mesh(section_id, keys, parts)
        prepare_section(obj, axes[section_id], material)
        outputs.append(obj)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in outputs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = outputs[0]
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_materials="EXPORT",
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_all_vertex_colors=False,
        export_skins=False,
        export_morph=False,
        export_yup=True,
    )
    if not output.is_file() or output.stat().st_size <= 0:
        raise RuntimeError("OUTPUT_FILE_MISSING")
    print(f"REFINED_MANNEQUIN_BUILD_OK:{output.stat().st_size}")


def main() -> None:
    arguments = parse_arguments()
    build(Path(arguments.source).resolve(), Path(arguments.output).resolve())


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
