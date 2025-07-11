#!/usr/bin/env python3

import sys
import os
from PIL import Image, ImageFilter
import numpy as np
from collections import Counter

# Windows Unicode fix
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Check if scipy is available
try:
    from scipy import ndimage
    HAS_SCIPY = True
    print("SCIPY: Available - using advanced processing")
except ImportError:
    HAS_SCIPY = False
    print("SCIPY: Not found - using fallback processing")

def simple_connected_components(mask_array):
    """Simple connected components without scipy (flood fill)"""
    height, width = mask_array.shape
    visited = np.zeros_like(mask_array, dtype=bool)
    components = []
    
    def flood_fill(start_y, start_x, component_pixels):
        stack = [(start_y, start_x)]
        
        while stack:
            y, x = stack.pop()
            
            if (y < 0 or y >= height or x < 0 or x >= width or 
                visited[y, x] or mask_array[y, x] == 0):
                continue
                
            visited[y, x] = True
            component_pixels.append((y, x))
            
            # Check 8-connected neighbors
            for dy in [-1, 0, 1]:
                for dx in [-1, 0, 1]:
                    if dy == 0 and dx == 0:
                        continue
                    stack.append((y + dy, x + dx))
    
    # Find all components
    for y in range(height):
        for x in range(width):
            if mask_array[y, x] > 0 and not visited[y, x]:
                component_pixels = []
                flood_fill(y, x, component_pixels)
                if len(component_pixels) > 10:  # Ignore very small components
                    components.append(component_pixels)
    
    return components

def simple_closing(mask_array, kernel_size=3):
    """Simple morphological closing without scipy"""
    height, width = mask_array.shape
    result = mask_array.copy()
    
    # Simplified closing operation
    for iteration in range(2):
        # Dilation
        dilated = np.zeros_like(result)
        for y in range(height):
            for x in range(width):
                if result[y, x] > 0:
                    for dy in range(-kernel_size//2, kernel_size//2 + 1):
                        for dx in range(-kernel_size//2, kernel_size//2 + 1):
                            ny, nx = y + dy, x + dx
                            if 0 <= ny < height and 0 <= nx < width:
                                dilated[ny, nx] = 255
        result = dilated
    
    return result

def detect_background_color(img, sample_size=100):
    """Poboljsana detekcija pozadine"""
    width, height = img.size
    edge_pixels = []
    
    step_x = max(1, width // sample_size)
    step_y = max(1, height // sample_size)
    
    # Sample edges
    for x in range(0, width, step_x):
        edge_pixels.append(img.getpixel((x, 0)))
        edge_pixels.append(img.getpixel((x, height-1)))
    
    for y in range(0, height, step_y):
        edge_pixels.append(img.getpixel((0, y)))
        edge_pixels.append(img.getpixel((width-1, y)))
    
    # Corners with more weight
    corners = [
        img.getpixel((0, 0)),
        img.getpixel((width-1, 0)),
        img.getpixel((0, height-1)),
        img.getpixel((width-1, height-1))
    ]
    edge_pixels.extend(corners * 5)
    
    if img.mode == 'RGBA':
        simplified_pixels = [(r, g, b) for r, g, b, a in edge_pixels if a > 200]
    else:
        simplified_pixels = edge_pixels
    
    if not simplified_pixels:
        return None
    
    most_common = Counter(simplified_pixels).most_common(3)
    
    if most_common:
        bg_color = most_common[0][0]
        confidence = most_common[0][1] / len(simplified_pixels)
        
        print(f"Background: {bg_color} (confidence: {confidence:.2f})")
        
        if confidence < 0.3:
            print("Low confidence - edge detection fallback")
            return None
            
        return bg_color
    
    return None

def is_similar_color(color1, color2, tolerance=30):
    """Poboljsano poredenje boja"""
    if len(color1) != len(color2):
        return False
    
    if all(c > 200 for c in color1[:3]):
        tolerance = min(tolerance, 25)
    elif all(c < 50 for c in color1[:3]):
        tolerance = max(tolerance, 40)
    
    distance = sum(abs(c1 - c2) for c1, c2 in zip(color1, color2))
    return distance <= tolerance * len(color1)

def create_advanced_mask(img, bg_color, tolerance=50):
    """Kreiraj naprednu masku sa ili bez scipy"""
    width, height = img.size
    mask = Image.new('L', (width, height), 0)
    mask_data = []
    
    for y in range(height):
        for x in range(width):
            pixel = img.getpixel((x, y))
            pixel_rgb = pixel[:3] if len(pixel) >= 3 else pixel
            
            if not is_similar_color(pixel_rgb, bg_color, tolerance=tolerance):
                mask_data.append(255)
            else:
                mask_data.append(0)
    
    mask.putdata(mask_data)
    
    # Clean noise
    mask = mask.filter(ImageFilter.MedianFilter(size=3))
    
    # Morphological operations
    mask_np = np.array(mask)
    
    if HAS_SCIPY:
        # Advanced processing with scipy
        kernel = np.ones((5, 5), np.uint8)
        mask_closed = ndimage.binary_closing(mask_np > 127, structure=kernel)
        mask = Image.fromarray((mask_closed * 255).astype(np.uint8))
        print("MORPHOLOGY: Used scipy operations")
    else:
        # Fallback without scipy
        mask_closed = simple_closing(mask_np, kernel_size=3)
        mask = Image.fromarray(mask_closed.astype(np.uint8))
        print("MORPHOLOGY: Used fallback operations")
    
    return mask

def find_connected_components(mask):
    """Pronadji komponente sa ili bez scipy"""
    mask_np = np.array(mask)
    
    if HAS_SCIPY:
        # Advanced with scipy
        labeled_array, num_features = ndimage.label(mask_np > 127)
        
        if num_features == 0:
            return mask
        
        component_sizes = ndimage.sum(mask_np > 127, labeled_array, range(num_features + 1))
        largest_component = np.argmax(component_sizes[1:]) + 1
        main_mask = (labeled_array == largest_component)
        
        # Add nearby components (za rucke solje!)
        main_coords = np.where(main_mask)
        if len(main_coords[0]) > 0:
            main_center_y = np.mean(main_coords[0])
            main_center_x = np.mean(main_coords[1])
            
            for i in range(1, num_features + 1):
                if i == largest_component:
                    continue
                    
                component_mask = (labeled_array == i)
                component_coords = np.where(component_mask)
                
                if len(component_coords[0]) > 0:
                    comp_center_y = np.mean(component_coords[0])
                    comp_center_x = np.mean(component_coords[1])
                    
                    distance = ((main_center_x - comp_center_x)**2 + (main_center_y - comp_center_y)**2)**0.5
                    max_distance = max(mask.size) * 0.3
                    
                    if distance < max_distance:
                        main_mask = main_mask | component_mask
                        print(f"HANDLE DETECTED: Added component at {distance:.1f}px distance")
        
        result_mask = Image.fromarray((main_mask * 255).astype(np.uint8))
        print("COMPONENTS: SciPy analysis used")
        
    else:
        # Fallback without scipy
        components = simple_connected_components(mask_np > 127)
        
        if not components:
            return mask
            
        # Find largest component
        largest_component = max(components, key=len)
        main_mask = np.zeros_like(mask_np)
        
        for y, x in largest_component:
            main_mask[y, x] = 255
            
        # Add nearby components (za rucke!)
        if len(largest_component) > 0:
            main_ys = [y for y, x in largest_component]
            main_xs = [x for y, x in largest_component]
            main_center_y = sum(main_ys) / len(main_ys)
            main_center_x = sum(main_xs) / len(main_xs)
            
            for component in components:
                if component == largest_component:
                    continue
                    
                if len(component) > 0:
                    comp_ys = [y for y, x in component]
                    comp_xs = [x for y, x in component]
                    comp_center_y = sum(comp_ys) / len(comp_ys)
                    comp_center_x = sum(comp_xs) / len(comp_xs)
                    
                    distance = ((main_center_x - comp_center_x)**2 + (main_center_y - comp_center_y)**2)**0.5
                    max_distance = max(mask.size) * 0.3
                    
                    if distance < max_distance:
                        for y, x in component:
                            main_mask[y, x] = 255
                        print(f"HANDLE DETECTED: Added component at {distance:.1f}px distance")
        
        result_mask = Image.fromarray(main_mask.astype(np.uint8))
        print("COMPONENTS: Fallback analysis used")
    
    return result_mask

def smart_padding_calculation(bbox, img_size, base_padding):
    """Pametno racunanje padding-a"""
    width, height = img_size
    obj_width = bbox[2] - bbox[0]
    obj_height = bbox[3] - bbox[1]
    
    obj_area_percent = (obj_width * obj_height) / (width * height)
    
    if obj_area_percent > 0.7:
        padding_multiplier = 0.5
    elif obj_area_percent > 0.4:
        padding_multiplier = 1.0
    else:
        padding_multiplier = 1.5
    
    adaptive_padding = int(base_padding * padding_multiplier)
    
    print(f"PADDING: Object area {obj_area_percent:.2f}, final padding {adaptive_padding}px")
    
    return adaptive_padding

def auto_crop_smart(image_path, output_path, padding=5):
    """Smart crop - NAPREDNA VERZIJA ZA RUCKE SOLJE"""
    try:
        print(f"=== SMART CROP v2.1 ({'SciPy' if HAS_SCIPY else 'Fallback'} mode) ===")
        print(f"INPUT: {os.path.basename(image_path)}")
        print(f"PADDING: {padding}px base")
        
        img = Image.open(image_path)
        original_mode = img.mode
        
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
        
        width, height = img.size
        print(f"SIZE: {width}x{height} original")
        
        # Pokusaj 1: Alpha crop
        alpha = img.split()[-1]
        bbox_alpha = alpha.getbbox()
        
        if bbox_alpha and (bbox_alpha[2] - bbox_alpha[0] < width * 0.95 or bbox_alpha[3] - bbox_alpha[1] < height * 0.95):
            print("METHOD: Alpha-based crop")
            adaptive_padding = smart_padding_calculation(bbox_alpha, (width, height), padding)
            
            padded_bbox = (
                max(0, bbox_alpha[0] - adaptive_padding),
                max(0, bbox_alpha[1] - adaptive_padding),
                min(width, bbox_alpha[2] + adaptive_padding),
                min(height, bbox_alpha[3] + adaptive_padding)
            )
            
            cropped = img.crop(padded_bbox)
            
        else:
            print("METHOD: Advanced color-based crop")
            bg_color = detect_background_color(img)
            
            if bg_color is None:
                print("RESULT: Keeping original (no clear background)")
                cropped = img
            else:
                # Povecana tolerancija za bele pozadine
                tolerance = 80 if all(c > 200 for c in bg_color[:3]) else 50
                print(f"TOLERANCE: {tolerance}")
                
                mask = create_advanced_mask(img, bg_color, tolerance)
                final_mask = find_connected_components(mask)
                
                bbox_color = final_mask.getbbox()
                
                if bbox_color:
                    adaptive_padding = smart_padding_calculation(bbox_color, (width, height), padding)
                    
                    padded_bbox = (
                        max(0, bbox_color[0] - adaptive_padding),
                        max(0, bbox_color[1] - adaptive_padding),
                        min(width, bbox_color[2] + adaptive_padding),
                        min(height, bbox_color[3] + adaptive_padding)
                    )
                    
                    cropped = img.crop(padded_bbox)
                    print("RESULT: Crop successful")
                else:
                    print("RESULT: No content found, keeping original")
                    cropped = img
        
        # Save result
        if original_mode == 'RGB' and cropped.mode == 'RGBA':
            background = Image.new('RGB', cropped.size, (255, 255, 255))
            background.paste(cropped, mask=cropped.split()[-1])
            cropped = background
        
        save_format = 'PNG' if original_mode in ['RGBA', 'LA', 'P'] else 'JPEG'
        if save_format == 'JPEG' and cropped.mode == 'RGBA':
            background = Image.new('RGB', cropped.size, (255, 255, 255))
            background.paste(cropped, mask=cropped.split()[-1])
            cropped = background
        
        save_kwargs = {'quality': 95, 'optimize': True} if save_format == 'JPEG' else {'optimize': True}
        
        cropped.save(output_path, save_format, **save_kwargs)
        print(f"OUTPUT: {cropped.size} saved as {save_format}")
        print("STATUS: SUCCESS")
        
        return True
        
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return False

def main():
    if len(sys.argv) < 3:
        print("Usage: python cropper.py <input> <output> [padding]")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    padding = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    
    padding = max(0, min(padding, 100))
    
    if not os.path.exists(input_path):
        print(f"ERROR: Input file not found: {input_path}")
        sys.exit(1)
    
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    success = auto_crop_smart(input_path, output_path, padding)
    
    if success:
        print("=== COMPLETED ===")
        sys.exit(0)
    else:
        print("=== FAILED ===")
        sys.exit(1)

if __name__ == "__main__":
    main()